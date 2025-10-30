
from utils.log_manager import logger
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
        """
        Create a role-based prompt for the model as a meeting secretary.
        The model should only answer using the given transcript.
        If no relevant information is found, return a fallback message.
        The answer must always be in the same language as the question,
        even if the transcript is in another language.
        """
        return (
            "You are a professional meeting assistant AI. Your role is to answer questions STRICTLY based on the provided meeting transcript below.\n\n"
            "CRITICAL RULES:\n"
            "1. ONLY use information from the transcript below\n"
            "2. DO NOT make up or fabricate any information\n"
            "3. DO NOT add extra conversations or scenarios\n"
            "4. If the transcript doesn't contain the answer, say: 'Không tìm thấy thông tin trong cuộc họp'\n"
            "5. Keep your answer SHORT (maximum 2 sentences)\n"
            "6. Answer in the SAME LANGUAGE as the question\n\n"
            f"===== MEETING TRANSCRIPT =====\n{data}\n===== END TRANSCRIPT =====\n\n"
            f"Question: {question}\n\n"
            "Answer (SHORT, based ONLY on transcript above):"
        )

    def generate_response(self, data: str, answer: str) -> str:
        return f'Generated response based on data: {data}. Answer from model: {answer}'

    async def ask(self, question: str, room_id: str, organization_id: str = None, room_key: str = None) -> str:
        """
        Process a question and return an answer based on semantic context.
        
        Args:
            question: User's question
            room_id: Room ID (for backward compatibility)
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation (NEW, preferred over room_id)
        """
        try:
            # Call semantic service to search data
            logger.info(f"Calling semantic service with room_id={room_id}, room_key={room_key}, question={question}")
            results = await self.semantic_client.search(
                room_id=room_id, 
                text=question, 
                organization_id=organization_id,
                room_key=room_key  # NEW: Pass room_key
            )
            
            # Convert to list to safely check length
            results_list = list(results) if results else []
            logger.info(f"Received {len(results_list)} results from semantic service")
            
            if results_list and len(results_list) > 0:
                logger.info(f"Processing {len(results_list)} results from semantic service")
                # Extract text from results and combine them
                transcript_data = []
                for result in results_list:
                    transcript_data.append(result.text)
                combined_transcript = "\n".join(transcript_data)
                
                # Create prompt with the response data
                prompt = self.create_prompt(question, combined_transcript)
                
                # Generate response using the model
                generated_response = self.model.generate(prompt)
                logger.info(f"Generated response: {generated_response} for question: {question} with {len(results_list)} results" + 
                           (f" for organization {organization_id}" if organization_id else "") +
                           (f" with room_key {room_key}" if room_key else "") +
                           (f" with transcript: {combined_transcript[:50]}..." if combined_transcript else ""))
                # return generated_response
                return self.generate_response(combined_transcript, generated_response)
            else:
                logger.warning(f"No results found from semantic service for room {room_id} (room_key: {room_key})")
                return "I'm sorry, I couldn't find an answer to your question."

        except Exception as e:
            logger.error(f"Error processing question: {e}")
            import traceback
            traceback.print_exc()
            return "Error processing question"
    
