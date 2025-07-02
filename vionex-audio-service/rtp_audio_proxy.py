import asyncio
import socket
import subprocess
import wave
import time

IN_PORT = 5004  # port mà Mediasoup gửi RTP vào
OUT_IP = '127.0.0.1'  # IP của Mediasoup plain transport outbound
OUT_PORT = 5006       # port mà Mediasoup chờ nhận lại RTP
SAMPLE_RATE = 48000
CHANNELS = 1

def process_audio(pcm_bytes: bytes) -> bytes:
    """
    Hàm này xử lý âm thanh nhận vào và trả ra PCM bytes mới.
    Bạn có thể:
    - Whisper để lấy text
    - TTS để tạo giọng mới
    - Clone giọng từ người nói
    - Dịch ngôn ngữ
    """
    # TODO: thay bằng xử lý thực tế của bạn
    return pcm_bytes  # ví dụ: tạm thời không thay đổi gì

async def receive_rtp_and_send():
    in_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    in_sock.bind(('0.0.0.0', IN_PORT))

    out_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    ffmpeg_input = subprocess.Popen([
        'ffmpeg',
        '-f', 'sdp',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ac', str(CHANNELS),
        '-ar', str(SAMPLE_RATE),
        '-'
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    # SDP để ffmpeg nhận RTP từ Mediasoup
    sdp = f"""
v=0
o=- 0 0 IN IP4 127.0.0.1
s=mediasoup-rtp
c=IN IP4 127.0.0.1
t=0 0
m=audio {IN_PORT} RTP/AVP 96
a=rtpmap:96 opus/{SAMPLE_RATE}/{CHANNELS}
"""

    ffmpeg_input.stdin.write(sdp.encode())
    ffmpeg_input.stdin.close()

    print("Đang nhận RTP từ Mediasoup...")

    while True:
        pcm_chunk = ffmpeg_input.stdout.read(960 * 2)  # đọc 20ms opus đã giải mã thành PCM (16bit)
        if not pcm_chunk:
            break

        # Xử lý audio tại đây
        processed = process_audio(pcm_chunk)

        # Gửi lại audio qua Mediasoup (bạn cần encode lại nếu cần codec, ở đây ta giữ raw PCM)
        out_sock.sendto(processed, (OUT_IP, OUT_PORT))

if __name__ == "__main__":
    try:
        asyncio.run(receive_rtp_and_send())
    except KeyboardInterrupt:
        print("Kết thúc.")
