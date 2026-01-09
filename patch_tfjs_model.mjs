import fs from "fs";
import path from "path";

const modelPath = path.resolve("public", "model_js", "model.json");
const raw = fs.readFileSync(modelPath, "utf8");
const j = JSON.parse(raw);

const cfg = j.modelTopology?.model_config?.config;
if (!cfg) throw new Error("Could not find modelTopology.model_config.config");

const layers = cfg.layers;

// 1) Fix input_layers / output_layers if missing/bad
cfg.input_layers = cfg.input_layers ?? [["input_layer", 0, 0], ["input_layer_1", 0, 0]];
cfg.output_layers = Array.isArray(cfg.output_layers) && Array.isArray(cfg.output_layers[0])
  ? cfg.output_layers
  : [["dense_5", 0, 0]];

// 2) Normalize inbound_nodes: remove the extra nesting level everywhere
function normalizeInboundNodes(inb) {
  if (!Array.isArray(inb)) return inb;

  // inbound_nodes = [ node0, node1, ... ]
  return inb.map(node => {
    // node = [ inboundTensor0, inboundTensor1, ... ]
    // Sometimes it’s wrapped like: [[ [..] ]] -> unwrap until it looks right.
    while (
      Array.isArray(node) &&
      node.length === 1 &&
      Array.isArray(node[0]) &&
      (node[0].length === 0 || Array.isArray(node[0][0]))
    ) {
      node = node[0];
    }
    return node;
  });
}

for (const layer of layers) {
  layer.inbound_nodes = normalizeInboundNodes(layer.inbound_nodes);
}

// 3) Fix concatenate inbound_nodes explicitly (this is REQUIRED)
const concat = layers.find(l => l.name === "concatenate");
if (!concat) throw new Error("No layer named 'concatenate' found");

concat.inbound_nodes = [
  [
    ["dropout_3", 0, 0, {}],
    ["dropout_5", 0, 0, {}],
  ],
];

// 4) Make InputLayer config TFJS-friendly (should already be OK, but enforce)
for (const layer of layers) {
  if (layer.class_name === "InputLayer") {
    const c = layer.config;
    if (c.batch_shape && !c.batchInputShape) c.batchInputShape = c.batch_shape;
    delete c.batch_shape;
  }
}

fs.writeFileSync(modelPath, JSON.stringify(j, null, 2));
console.log("✅ Patched model.json:", modelPath);
