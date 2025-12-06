
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
            "You are a professional meeting assistant AI. Your role is to answer questions based on the provided meeting transcript below.\n\n"
            "CRITICAL RULES:\n"
            "1. ONLY use information from the transcript below\n"
            "2. DO NOT make up or fabricate any information\n"
            "3. DO NOT add extra conversations or scenarios\n"
            "4. If the transcript doesn't contain the answer, say: 'Tôi không tìm thấy thông tin về điều này trong cuộc họp.' (Vietnamese) or 'I couldn't find information about this in the meeting.' (English)\n"
            "5. Provide a COMPLETE and DETAILED answer (3-5 sentences) that fully addresses the question\n"
            "6. Answer in the SAME LANGUAGE as the question\n"
            "7. Use natural, conversational language\n"
            "8. Include relevant context and details from the transcript\n\n"
            f"===== MEETING TRANSCRIPT =====\n{data}\n===== END TRANSCRIPT =====\n\n"
            f"Question: {question}\n\n"
            "Answer (DETAILED and COMPLETE, based on transcript above):"
        )

    def create_summary_extraction_prompt(self, transcript: str) -> str:
        """
        Create a prompt to extract meeting summary and deadlines in JSON format.
        """
        return (
            "You are a professional meeting secretary AI. Analyze the meeting transcript below and extract:\n"
            "1. Meeting summary (key points discussed)\n"
            "2. All deadlines, tasks, and action items mentioned\n\n"
            "CRITICAL RULES:\n"
            "1. ONLY extract information that is EXPLICITLY mentioned in the transcript\n"
            "2. DO NOT make up or infer dates/times that are not stated\n"
            "3. For dates, convert relative references (e.g., 'next week', 'tomorrow') to actual dates based on today being November 18, 2025\n"
            "4. Extract in Vietnamese if transcript is in Vietnamese, otherwise in English\n"
            "5. Return ONLY valid JSON, no additional text\n\n"
            "JSON Format:\n"
            "{\n"
            '  "meeting_summary": "Brief summary of the meeting",\n'
            '  "deadlines": [\n'
            "    {\n"
            '      "task": "Task description",\n'
            '      "assignee": "Person responsible (if mentioned)",\n'
            '      "deadline": "YYYY-MM-DD or description if not specific",\n'
            '      "priority": "high/medium/low (if mentioned)"\n'
            "    }\n"
            "  ]\n"
            "}\n\n"
            f"===== MEETING TRANSCRIPT =====\n{transcript}\n===== END TRANSCRIPT =====\n\n"
            "Extract JSON (ONLY valid JSON, no markdown, no extra text):"
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
                
                # Return the generated response directly (remove debug info)
                return generated_response
            else:
                logger.warning(f"No results found from semantic service for room {room_id} (room_key: {room_key})")
                return "I'm sorry, I couldn't find an answer to your question."

        except Exception as e:
            logger.error(f"Error processing question: {e}")
            import traceback
            traceback.print_exc()
            return "Error processing question"

    async def extract_meeting_summary(self, room_id: str, organization_id: str = None, room_key: str = None) -> str:
        """
        Extract meeting summary and deadlines from the meeting transcript.
        
        Args:
            room_id: Room ID (for backward compatibility)
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation
            
        Returns:
            JSON string containing meeting summary and deadlines
        """
        try:
            # Get all transcript data from semantic service
            # Use a broad query to get comprehensive transcript coverage
            logger.info(f"Extracting meeting summary for room_id={room_id}, room_key={room_key}")
            results = await self.semantic_client.search(
                room_id=room_id,
                text="meeting discussion agenda action item task deadline",  # Broad query to capture meeting content
                organization_id=organization_id,
                room_key=room_key
            )
            
            results_list = list(results) if results else []
            logger.info(f"Received {len(results_list)} transcript chunks for summary extraction")
            
            if not results_list or len(results_list) == 0:
                return '{"meeting_summary": "Không có nội dung cuộc họp để tóm tắt.", "deadlines": []}'
            
            # Combine all transcript chunks
            transcript_data = [result.text for result in results_list]
            combined_transcript = "\n".join(transcript_data)
            
            # Create extraction prompt
            prompt = self.create_summary_extraction_prompt(combined_transcript)
            
            # Generate JSON response
            json_response = self.model.generate(prompt)
            logger.info(f"Generated summary JSON for room {room_id}")
            
            # Clean up response - remove markdown code blocks if present
            json_response = json_response.strip()
            if json_response.startswith("```json"):
                json_response = json_response[7:]
            if json_response.startswith("```"):
                json_response = json_response[3:]
            if json_response.endswith("```"):
                json_response = json_response[:-3]
            json_response = json_response.strip()
            
            # Validate JSON
            import json
            try:
                json.loads(json_response)  # Just validate, don't modify
                return json_response
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON generated: {e}")
                return '{"meeting_summary": "Lỗi khi trích xuất thông tin cuộc họp.", "deadlines": []}'
            
        except Exception as e:
            logger.error(f"Error extracting meeting summary: {e}")
            import traceback
            traceback.print_exc()
            return '{"meeting_summary": "Lỗi khi xử lý yêu cầu.", "deadlines": []}'
    
