"""
 * Copyright (c) 2025 xuantruongg003
 *
 * This software is licensed for non-commercial use only.
 * You may use, study, and modify this code for educational and research purposes.
 *
 * Commercial use of this code, in whole or in part, is strictly prohibited
 * without prior written permission from the author.
 *
 * Author Contact: lexuantruong098@gmail.com
 */
"""

import logging
# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
from core.model import model  # Import pre-loaded model
from clients.semantic import SemanticClient

class ChatBotProcessor:
    def __init__(self):
        """Initialize audio processor with pre-loaded Whisper model"""
        # Use pre-loaded model from core.model
        self.model = model
        self.semantic_client = SemanticClient()

        # Verify model is loaded
        if self.model is None:
            logger.error("Cannot load model")
        else:
            logger.info(f"Loaded model")

    def create_prompt(self, question: str, data: str) -> str:
        """Create prompt for the model"""
        return f"Question: {question}\nData: {data}"

    def ask(self, question: str, room_id: str) -> str:
        try:
            # Call semantic service to search data
            response = self.semantic_client.search(room_id=room_id, text=question)
            if response:
                # Create prompt with the response data
                prompt = self.create_prompt(question, response)
                
                # Generate response using the model
                generated_response = self.model.generate(prompt)
                logger.info(f"Generated response: {generated_response} for question: {question} with data: {response}")
                return generated_response
            else:
                logger.warning("No response from semantic service")
                return "I'm sorry, I couldn't find an answer to your question."

        except Exception as e:
            logger.error(f"Error processing question: {e}")
            return "Error processing question"
            
        except Exception as e:
            logger.error(f"Error saving transcript: {e}")
            return False
    
