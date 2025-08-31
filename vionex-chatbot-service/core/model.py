from transformers import AutoModelForCausalLM, AutoTokenizer
# from peft import PeftModel, PeftConfig

# base_model = AutoModelForCausalLM.from_pretrained(
#     "/kaggle/input/openchat-3-5-0106",
#     device_map="auto",
#     torch_dtype=torch.float16,
#     trust_remote_code=True
# )

# model = PeftModel.from_pretrained(base_model, "./openchat-lora-only")
model = None