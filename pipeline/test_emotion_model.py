import torch
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
)

MODEL_NAME = "patrickramos/bert-base-japanese-v2-wrime-fine-tune"

TEXT = "友人が帰ってきて安心したが、少し悲しい気持ちも残った。"

print("Loading model...")

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
model.eval()

inputs = tokenizer(
    TEXT,
    return_tensors="pt",
    truncation=True,
    max_length=256,
)

with torch.inference_mode():
    output = model(**inputs)

scores = output.logits[0].cpu().tolist()

print(f"\nText: {TEXT}")
print(f"Number of outputs: {len(scores)}")
print("Configured labels:", model.config.id2label)

for i, score in enumerate(scores):
    print(f"Output {i:2d}: {score:.3f}")
