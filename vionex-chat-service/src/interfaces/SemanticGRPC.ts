import { Observable } from 'rxjs/internal/Observable';

interface SaveTranscriptRequest {
    room_id: string;
    room_key?: string; // NEW: Room key for semantic context isolation
    speaker: string;
    text: string;
    timestamp: string;
    organization_id?: string;
}

export default interface SemanticService {
    saveTranscript(data: SaveTranscriptRequest): Observable<any>;
}
