
from core.model import model_vi_en, tokenizer

class TranslateProcess:
    """
        Class to handle translation between English and Vietnamese using MarianMTModel.
    """
    def __init__(self):
        self.tokenizer = tokenizer
        self.model = model_vi_en

    def translate_vi_to_en(self, vietnamese_sentences):
        # Tokenize input sentences
        inputs = self.tokenizer(vietnamese_sentences, return_tensors="pt", padding=True, truncation=True)
        
        # Generate translations
        translated = self.model.generate(**inputs)
        
        # Decode the generated tokens to English sentences
        english_sentences = [self.tokenizer.decode(t, skip_special_tokens=True) for t in translated]
        
        return english_sentences