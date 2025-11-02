import torch
import logging
import os
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel, PeftConfig
from huggingface_hub import snapshot_download, login

logger = logging.getLogger(__name__)

# Check if GPU is available
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {device}")

# Hugging Face authentication
hf_token = os.getenv("HUGGINGFACE_TOKEN")
if hf_token:
    try:
        login(token=hf_token)
        logger.info("Successfully authenticated with Hugging Face")
    except Exception as e:
        logger.warning(f"Failed to authenticate with Hugging Face: {e}")

try:
    # Model configuration
    base_model_repo = os.getenv("BASE_MODEL_REPO", "your-username/your-private-model")
    lora_model_repo = os.getenv("LORA_MODEL_REPO", "your-username/your-private-lora")
    local_cache_dir = os.getenv("MODEL_CACHE_DIR", "/app/models/.cache")
    
    # Try to download/load base model
    logger.info(f"Loading base model: {base_model_repo}")
    
    # Download model if it's a HF repo ID, otherwise use local path
    if "/" in base_model_repo and not os.path.exists(base_model_repo):
        base_model_path = snapshot_download(
            repo_id=base_model_repo,
            cache_dir=local_cache_dir,
            token=hf_token,
            local_files_only=False
        )
    else:
        base_model_path = base_model_repo
    
    
    # Load base model
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_path,
        device_map="auto",
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        trust_remote_code=True,
        token=hf_token
    )
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        base_model_path, 
        trust_remote_code=True,
        token=hf_token
    )
    
    # Try to load LoRA adapter
    model = base_model  # Default to base model
    
    if lora_model_repo:
        try:
            # Download LoRA if it's a HF repo ID
            if "/" in lora_model_repo and not os.path.exists(lora_model_repo):
                lora_path = snapshot_download(
                    repo_id=lora_model_repo,
                    cache_dir=local_cache_dir,
                    token=hf_token,
                    local_files_only=False
                )
            else:
                lora_path = lora_model_repo
            
            if os.path.exists(lora_path):
                logger.info(f"Loading LoRA adapter from: {lora_path}")
                model = PeftModel.from_pretrained(base_model, lora_path)
            else:
                logger.warning(f"LoRA adapter not found, using base model only")
                
        except Exception as e:
            logger.warning(f"Failed to load LoRA adapter: {e}, using base model only")
    
    logger.info("Model loaded successfully")
    
except Exception as e:
    logger.error(f"Error loading model: {e}")
    # Fallback - create a dummy model for testing
    model = None
    tokenizer = None

# Simple wrapper for model inference
class SimpleModel:
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer
        
    def generate(self, prompt):
        if self.model is None:
            return "Model not available"
        
        try:
            inputs = self.tokenizer.encode(prompt, return_tensors="pt")
            if device == "cuda":
                inputs = inputs.to(device)
                
            with torch.no_grad():
                outputs = self.model.generate(
                    inputs, 
                    max_new_tokens=100,  # Limit to 100 new tokens (~2-3 sentences)
                    temperature=0.7,
                    do_sample=True,
                    top_p=0.9,  # Nucleus sampling for better quality
                    repetition_penalty=1.2,  # Prevent repetition
                    pad_token_id=self.tokenizer.eos_token_id,
                    eos_token_id=self.tokenizer.eos_token_id
                )
            
            response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            # Extract only the answer part (remove prompt)
            answer = response.replace(prompt, "").strip()
            
            # Additional safety: truncate at first newline after answer starts
            # to prevent generating fake transcripts
            if "\n\n" in answer:
                answer = answer.split("\n\n")[0].strip()
            
            return answer
            
        except Exception as e:
            logger.error(f"Error generating: {e}")
            return "Error generating response"

# Initialize the model wrapper
model = SimpleModel(model, tokenizer) if model is not None else None