//! Exact vertex-ranking solver for HOWL shapes.
//!
//! Computes the provably optimal rank (treedepth) of small grid shapes by
//! exhaustive recursion over u128 bitboards, and reconstructs one optimal cut
//! sequence per shape.
//!
//! Deliberately narrow interface: it never computes canonical hashes and never
//! touches the database. Hashes are passed through untouched so `core_engine`
//! stays the single source of truth for hashing, and the Python importer owns
//! all writes.
//!
//! Protocol (tab-separated, one shape per line):
//!   stdin   <hash>\t<shape_str>            e.g. abc123\t0,0|0,1|1,0
//!   stdout  <hash>\tok\t<rank>\t<cuts>     cuts as "x,y|x,y|..." (may be empty)
//!           <hash>\tskip\t<reason>         shape does not fit a u128 board
//!
//! Shapes are assumed origin-normalized, as produced by core_engine.hashing.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};
use std::io::{self, BufWriter, Read, Write};

/// Multiply-shift hasher. The default SipHash dominates runtime when the memo
/// is hit millions of times per shape; keys here are already well-distributed
/// bitboards, so a single multiply is enough.
#[derive(Default)]
struct FastHasher(u64);

impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
    fn write_u128(&mut self, n: u128) {
        let mixed = (n as u64) ^ ((n >> 64) as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        self.0 = mixed.wrapping_mul(0xff51_afd7_ed55_8ccd);
        self.0 ^= self.0 >> 29;
    }
}

type Memo = HashMap<u128, u8, BuildHasherDefault<FastHasher>>;

const UNSOLVED: u8 = 99;

struct Board {
    stride: u32,
    not_first_col: u128,
    not_last_col: u128,
}

impl Board {
    fn new(stride: u32, rows: u32) -> Option<Board> {
        if stride == 0 || rows == 0 || (rows as u64) * (stride as u64) > 128 {
            return None;
        }
        let mut first_col: u128 = 0;
        let mut last_col: u128 = 0;
        for r in 0..rows {
            first_col |= 1u128 << (r * stride);
            last_col |= 1u128 << (r * stride + stride - 1);
        }
        Some(Board {
            stride,
            not_first_col: !first_col,
            not_last_col: !last_col,
        })
    }

    #[inline]
    fn neighbors(&self, bb: u128) -> u128 {
        let left = (bb << 1) & self.not_first_col;
        let right = (bb >> 1) & self.not_last_col;
        let down = bb.wrapping_shl(self.stride);
        let up = bb.wrapping_shr(self.stride);
        left | right | down | up
    }

    /// Split a mask into its connected components via flood fill.
    fn components(&self, mut mask: u128) -> Vec<u128> {
        let mut out = Vec::new();
        while mask != 0 {
            let mut comp = mask & mask.wrapping_neg();
            loop {
                let grown = (comp | self.neighbors(comp)) & mask;
                if grown == comp {
                    break;
                }
                comp = grown;
            }
            out.push(comp);
            mask ^= comp;
        }
        out
    }

    /// rank(G) = 1 + min over v of rank(G - v); at a fracture, the max over
    /// components (separator theorem).
    fn rank(&self, mask: u128, memo: &mut Memo) -> u8 {
        if mask == 0 {
            return 0;
        }
        if let Some(&cached) = memo.get(&mask) {
            return cached;
        }

        let result = if mask & (mask - 1) == 0 {
            1 // single vertex
        } else {
            let comps = self.components(mask);
            if comps.len() > 1 {
                comps.iter().map(|&c| self.rank(c, memo)).max().unwrap()
            } else {
                let mut best = UNSOLVED;
                let mut m = mask;
                while m != 0 {
                    let bit = m & m.wrapping_neg();
                    m ^= bit;
                    let value = 1 + self.rank(mask ^ bit, memo);
                    if value < best {
                        best = value;
                    }
                    if best == 1 {
                        break;
                    }
                }
                best
            }
        };

        memo.insert(mask, result);
        result
    }

    /// Reconstruct one optimal cut sequence. Single vertices are rank-1 leaves
    /// and need no cut, matching core_engine.replay_engine semantics.
    fn sequence(&self, mask: u128, memo: &mut Memo, out: &mut Vec<(u32, u32)>) {
        if mask == 0 || mask & (mask - 1) == 0 {
            return;
        }
        let comps = self.components(mask);
        if comps.len() > 1 {
            for c in comps {
                self.sequence(c, memo, out);
            }
            return;
        }

        let target = self.rank(mask, memo);
        let mut m = mask;
        while m != 0 {
            let bit = m & m.wrapping_neg();
            m ^= bit;
            if 1 + self.rank(mask ^ bit, memo) == target {
                let pos = bit.trailing_zeros();
                out.push((pos / self.stride, pos % self.stride));
                self.sequence(mask ^ bit, memo, out);
                return;
            }
        }
        unreachable!("no optimal cut found; memo inconsistent");
    }
}

fn parse_shape(shape: &str) -> Option<(Vec<(u32, u32)>, u32, u32)> {
    let mut cells = Vec::new();
    let (mut max_x, mut max_y) = (0u32, 0u32);
    for pair in shape.split('|') {
        let (a, b) = pair.split_once(',')?;
        let x: u32 = a.trim().parse().ok()?;
        let y: u32 = b.trim().parse().ok()?;
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        cells.push((x, y));
    }
    if cells.is_empty() {
        return None;
    }
    Some((cells, max_x + 1, max_y + 1))
}

enum Outcome {
    Solved { rank: u8, cuts: Vec<(u32, u32)> },
    Skipped(&'static str),
}

fn solve_shape(shape: &str) -> Outcome {
    let Some((cells, rows, cols)) = parse_shape(shape) else {
        return Outcome::Skipped("unparsable");
    };
    let Some(board) = Board::new(cols, rows) else {
        return Outcome::Skipped("bbox exceeds 128 bits");
    };

    let mut bb: u128 = 0;
    for (x, y) in cells {
        bb |= 1u128 << (x * board.stride + y);
    }

    let mut memo: Memo = Memo::default();
    let rank = board.rank(bb, &mut memo);
    let mut cuts = Vec::new();
    board.sequence(bb, &mut memo, &mut cuts);
    Outcome::Solved { rank, cuts }
}

fn main() {
    let threads: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(4, |n| n.get()));

    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("read stdin");

    let jobs: Vec<(&str, &str)> = input
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .collect();

    let chunk = jobs.len().div_ceil(threads.max(1));
    let mut results: Vec<String> = Vec::new();

    std::thread::scope(|scope| {
        let handles: Vec<_> = jobs
            .chunks(chunk.max(1))
            .map(|part| {
                scope.spawn(move || {
                    let mut lines = Vec::with_capacity(part.len());
                    for (hash, shape) in part {
                        match solve_shape(shape) {
                            Outcome::Solved { rank, cuts } => {
                                let joined: Vec<String> =
                                    cuts.iter().map(|(x, y)| format!("{x},{y}")).collect();
                                lines.push(format!("{hash}\tok\t{rank}\t{}", joined.join("|")));
                            }
                            Outcome::Skipped(reason) => {
                                lines.push(format!("{hash}\tskip\t{reason}"));
                            }
                        }
                    }
                    lines
                })
            })
            .collect();

        for handle in handles {
            results.extend(handle.join().expect("worker panicked"));
        }
    });

    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    for line in results {
        writeln!(out, "{line}").expect("write stdout");
    }
}
