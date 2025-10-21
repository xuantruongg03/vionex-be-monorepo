import { Observable } from 'rxjs/internal/Observable';

interface SaveTranscriptRequest {
    room_id: string;
    speaker: string;
    text: string;
    timestamp: string;
    organization_id?: string;
}

export default interface SemanticService {
    saveTranscript(data: SaveTranscriptRequest): Observable<any>;
}
