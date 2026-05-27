from graph_logic import generate_canonical_hash

h1 = generate_canonical_hash([{"x": 0, "y": 0}])
h2 = generate_canonical_hash([{"x": 0, "y": 0}, {"x": 1, "y": 0}])
h3 = generate_canonical_hash([{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 2, "y": 0}])
h4 = generate_canonical_hash([{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 0, "y": 1}])
h5 = generate_canonical_hash([{"x": 2, "y": 3}, {"x": 3, "y": 3}, {"x": 2, "y": 4}])

print("1x1:", h1)
print("2x1:", h2)
print("3x1:", h3)
print("L-shape 1:", h4)
print("L-shape 2:", h5)
