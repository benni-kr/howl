# AlphaWolf — Optimierungs-Roadmap

> Stand: 2026-08-16, Branch `feature/alphawolf-python-opts`.
> Ergebnis der Profiling- und Optimierungsrunde: Episodenzeit (7×7, 50 Sims)
> von **8,95s auf 2,88s** (~3×), verifiziert bitidentisch bzw. per Gauntlet.

## Bereits erledigt (auf diesem Branch)

- [x] Tarjan-Artikulationspunkte statt O(V²)-BFS in `_get_obs` (20× auf dichten Grids)
- [x] Vektorisierte PyG-Konvertierung (`grid_tensor_to_pyg_data`)
- [x] Tablebase-Cache + persistente SQLite-Verbindung (PID-guarded)
- [x] Env-Cloning ohne Wegwerf-Grid (`HowlEnv(generate=False)`)
- [x] MCTS Leaf Batching mit Virtual Loss (`mcts_batch_size`, Gauntlet/eval auf 1 gepinnt)
- [x] Grid-Größen-Hardcodings zentralisiert (`MAX_ROWS`/`MAX_COLS`, Config-Keys)
- [x] Memoisierung des kanonischen D₄-Hashings in `core_engine` (26× auf Hits)
- [x] `ARCHITECTURE.md` + `.agents`-Regeln auf GNN-Stand gebracht
- [x] D₄-Replay-Augmentierung: als für das GNN überflüssig nachgewiesen (strukturelle Invarianz)

---

## A) Hygiene zuerst *(Stunden, kein Risiko)*

- [ ] **Branch pushen + PR** — `feature/alphawolf-python-opts` existiert nur lokal;
  PR für Benjamins Review.
- [x] **`alphawolf/requirements.txt` fixen** — `torch_geometric` + `pandas` ergänzt,
  ungenutztes `sqlalchemy` entfernt.
- [x] **Tote Parameter entfernen** — `unlocked_tiers` komplett raus (bewusste Umstellung
  auf uniformes Sampling in `0736757`; C2 führt Curriculum sauber neu ein);
  `num_workers`-Override aus `globals()` gelöscht.
- [ ] **Tote Imports aufräumen** — `insert_or_update_rank4_induction` wird in `train.py`
  importiert, aber nie aufgerufen; der Effekt (Rang ≤ 4 ⇒ `is_optimal`) passiert
  ohnehin in `upsert_subgraph`. Ebenso ungenutzt: `DataLoader` (torch.utils.data,
  ersetzt durch den PyG-Loader) und `GridGraph`. Entweder Funktion samt Import
  entfernen oder bewusst wieder anschließen — aktuell existiert sie nur ungenutzt
  in `db/tablebase.py`.

## B) Performance-Reste *(abnehmender Ertrag)*

| Punkt | Aufwand | Einschätzung |
|---|---|---|
| `torch.compile` aufs GNN | klein | unbekannt, evtl. 1,2–1,5× auf die dominanten ~75 % NN-Zeit — letzter lohnender Performance-Versuch |
| Lokalisierte Komponentenprüfung („Block 2") | mittel | ~0,3s/Episode — **zurückgestellt** (Amdahl) |
| Bitboard-`GridGraph` | groß | **zurückgestellt** — shared Datenstruktur, gleicher Amdahl-Deckel |
| GPU | — | erst ab größerem Netz sinnvoll; Leaf Batching als Voraussetzung liegt bereit |

> Merksatz aus der C/Rust-Diskussion: **Geteilte Fundamente bleiben in der
> einfachsten Sprache, die reicht. Systemsprachen nur für isolierte,
> rechenintensive Werkzeuge mit schmaler Schnittstelle.**

## C) Trainingsqualität — der eigentliche Hebel jetzt

Bisher wurde nur *beschleunigt*, nichts *besser trainiert*.

1. [ ] **Warm-Start** — `alpha_zero_loop` startet jeden Lauf mit Zufallsgewichten
   und lädt `best_model.pt` nie. `load_state_dict` + `--fresh`-Option.
   *Kleinster Eingriff, womöglich größter Effekt.*
2. [ ] **Echtes Curriculum** — Freischalt-Mechanik neu einführen (das alte, tote
   `unlocked_tiers` wurde entfernt): neue Größe erst, wenn die aktuelle nahe am
   Lower Bound liegt (Formeln in `docs/Problem_Description.md`).
   Ersetzt das uniforme Sampling über `self_play_min/max_grid`.
3. [ ] **Temperatur bei der Zugwahl** — `play_episode` sampelt immer proportional
   zu den Besuchen. AlphaZero-Standard: früh explorativ (T=1), spät greedy (T→0). Fehlt komplett.
4. [ ] **Value-Normalisierung** — MSE auf rohen Rängen (4–20), Gewicht 0,5 und
   `VIRTUAL_LOSS_PENALTY=1.0` sind auf die kleine Skala kalibriert; auf Grid-Größe normieren.
5. [ ] **Hyperparameter-Ablation** — 128 Channels / 6 Layer sind geerbte Zahlen, nie getestet.
   Voraussetzung: Checkpoints speichern ihre Architektur; `evaluate_model` darf fremde
   Architekturen nicht mehr per `inf` disqualifizieren.
6. [ ] **Leaf-Batching-Tuning** — bei ≥200 Sims war batch=8 *besser* als sequenziell
   (Stichprobe n=2); systematisch bestätigen, ggf. Gauntlet-Pin überdenken.

## D) Skalierung auf größere Grids (>10×10)

Reihenfolge (Schritt 1 ist erledigt — Konstanten zentralisiert, 11×11-Smoke-Test grün):

1. [x] Hardcodings zentralisieren — Grid-Größe ist jetzt *eine* Konstante + Config
2. [ ] Checkpoint-Format mit Architektur-Hyperparametern + faire Benchmarks (= C5)
3. [ ] Value-/Virtual-Loss-Normalisierung (= C4)
4. [ ] Curriculum mit Lower-Bound-Kriterium (= C2)
5. [ ] **Globaler Kontext im Netz** — 6 Message-Passing-Hops sind auf 12×12+ blind
   (max. Distanz 38 bei 20×20). Kandidaten: virtueller Knoten, globale Feature-Konkatenation.
   Achtung Over-Smoothing bei mehr Layern.
6. [ ] Erst danach: Größen jenseits 10 freischalten; bei Bedarf inkrementelles Env, GPU

**Wichtige Eigenschaft:** Die GNN-Gewichte sind größenunabhängig — `best_model.pt`
läuft unverändert auf jedem Canvas (bewiesen mit 11×11 auf MAX=12). Werte jenseits
der Trainingsgrößen sind aber reine Extrapolation.

**DB-Stolperstein:** Sequenzen werden als Koordinaten persistiert (`{"t":"c","v":[[x,y]]}`) —
das bleibt kompatibel. Niemals flache Aktionsindizes persistieren (Index 23 bedeutet
je nach Canvas-Breite etwas anderes).

## E) Neue Werkzeuge / Forschungsbeitrag

- [x] **Exakter Solver V1 (Python-Bitboards)** — gebaut als `alphawolf/exact_solver.py`
  (Verify-Modus über DB-Bestand) + `upsert_exact_solution` in `db/tablebase.py`.
  Erster Lauf (≤18 Zellen, 144s): 1109 Formen — 813 bestätigt, **296 Ränge
  verbessert** (bis 12→5), 0 Konflikte. Optimal-Quote der DB: 2975 → 4084.
  Offen: Lauf für 19–26 Zellen (~1–2h), Enumerations-Modus (neue Formen
  erzeugen statt Bestand prüfen).
- [x] **Solver V2 in Rust** — `alphawolf/solver_rs/` (nur `std`, keine Crates, 8 Threads).
  Standalone-Binary, TSV über stdin/stdout; Python besitzt weiterhin Hashing und DB.
  **129× schneller** als V1; 600/600 Ränge identisch, 600/600 Sequenzen per
  `replay_rank` verifiziert. Anbindung über `exact_solver.py --backend rust`
  (Default `auto`), Python bleibt Fallback für Formen jenseits von u128.
- [ ] **DB-Verifikationslauf** — Solver über alle Bestandseinträge ohne `is_optimal`:
  bestätigt oder verbessert menschliche Lösungen, macht Perfection-Gaps beweisbar.

---

## Empfohlene Reihenfolge (Top 3)

1. **A komplett** — Branch pushen + PR ist der letzte offene Punkt.
2. **C1 + C3** (Warm-Start + Temperatur) — bestes Aufwand/Nutzen-Verhältnis im Katalog;
   danach ein Trainingslauf über Nacht als erster echter Test der Optimierungskette.
3. **E1, der Solver** — bedient als Einziger das Forschungsziel direkt,
   unabhängig von allem anderen.
