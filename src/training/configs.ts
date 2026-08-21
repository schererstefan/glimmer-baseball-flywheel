/**
 * Training configs — YAML-serializable presets. pnpm train:pipeline picks one via --config.
 * Real usage: `accelerate launch -m axolotl ...` or `unsloth` notebook.
 */
export type TrainConfig = {
  name: string;
  baseModel: string;
  method: "lora" | "full" | "dpo";
  lora?: { r: number; alpha: number; dropout: number; targetModules: string[] };
  training: { epochs: number; batchSize: number; lr: number; warmupRatio: number; maxSeqLen: number };
  data: { sftPath: string; dpoPath?: string; systemPrompt?: string };
};

export const PRESETS: Record<string, TrainConfig> = {
  "glimmer-lora-quick": {
    name: "glimmer-lora-quick",
    baseModel: "muse-glimmer",
    method: "lora",
    lora: { r: 16, alpha: 32, dropout: 0.05, targetModules: ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"] },
    training: { epochs: 2, batchSize: 4, lr: 2e-4, warmupRatio: 0.03, maxSeqLen: 2048 },
    data: { sftPath: "training/datasets/sft.jsonl", systemPrompt: "You are a baseball-knowledgeable assistant." },
  },
  "glimmer-lora-deep": {
    name: "glimmer-lora-deep",
    baseModel: "muse-glimmer",
    method: "lora",
    lora: { r: 64, alpha: 128, dropout: 0.05, targetModules: ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"] },
    training: { epochs: 3, batchSize: 8, lr: 1e-4, warmupRatio: 0.05, maxSeqLen: 4096 },
    data: { sftPath: "training/datasets/sft.jsonl", dpoPath: "training/datasets/dpo.jsonl" },
  },
  "glimmer-dpo": {
    name: "glimmer-dpo",
    baseModel: "glimmer-ft-lora-quick",
    method: "dpo",
    training: { epochs: 1, batchSize: 4, lr: 5e-5, warmupRatio: 0.1, maxSeqLen: 2048 },
    data: { sftPath: "training/datasets/sft.jsonl", dpoPath: "training/datasets/dpo.jsonl" },
  },
};
