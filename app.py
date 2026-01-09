import os
import hashlib
import hmac
import numpy as np
from flask import Flask, render_template, request, send_file, flash, jsonify
from Crypto.Cipher import ChaCha20
from PIL import Image
import io

app = Flask(__name__, static_url_path='', static_folder='.')
app.secret_key = os.environ.get("SECRET_KEY", "fallback-low-security-key")
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- CORE ENCRYPTION/DECRYPTION LOGIC ---

def embed_msg_logic(img_file, msg, password_str):
    password = password_str.encode()
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password, salt, 200_000, dklen=32)

    nonce = os.urandom(12)
    ciphertext = ChaCha20.new(key=key, nonce=nonce).encrypt(msg)
    header = len(ciphertext).to_bytes(4, "little") + salt + nonce
    mac = hmac.new(key, header + ciphertext, hashlib.sha256).digest()

    img = Image.open(img_file).convert("RGB")
    arr = np.array(img).astype(np.int16)
    h, w, c = arr.shape
    flat = arr.reshape(-1, 3)
    total_pixels = len(flat)

    if total_pixels < 512 or len(ciphertext) * 8 > (total_pixels - 512) * 0.5:
        raise ValueError("Error: Image too small or message too large for this image!")

    # Store Header + MAC (64 bytes = 512 bits)
    header_bits = [(b >> i) & 1 for b in (header + mac) for i in range(7, -1, -1)]
    for i, bit in enumerate(header_bits):
        flat[i][2] = (int(flat[i][2]) & ~1) | bit

    # Fisher-Yates Shuffle PRNG
    prng = ChaCha20.new(key=key, nonce=nonce)
    def prng_gen_func():
        while True:
            block = prng.encrypt(b"\x00" * 1024)
            for i in range(0, len(block), 4):
                yield int.from_bytes(block[i:i+4], "little")
    
    gen = prng_gen_func()
    indices = list(range(512, total_pixels))
    for i in range(len(indices)-1, 0, -1):
        j = next(gen) % (i+1)
        indices[i], indices[j] = indices[j], indices[i]

    # Store Ciphertext bits
    cipher_bits = [(byte >> i) & 1 for byte in ciphertext for i in range(7, -1, -1)]
    for i, bit in enumerate(cipher_bits):
        pix = indices[i]
        channel = pix % 3
        flat[pix][channel] = (flat[pix][channel] & ~1) | bit

    out_img = Image.fromarray(flat.reshape(h, w, 3).astype(np.uint8))
    img_io = io.BytesIO()
    out_img.save(img_io, 'PNG')
    img_io.seek(0)
    return img_io

def extract_msg_logic(img_file, password_str):
    password = password_str.encode()
    img = Image.open(img_file).convert("RGB")
    flat = np.array(img).reshape(-1, 3)
    
    # Extract Header + MAC
    extracted_bits = [flat[i][2] & 1 for i in range(512)]
    extracted_bytes = bytearray(int("".join(map(str, extracted_bits[i:i+8])), 2) for i in range(0, 512, 8))

    msg_len = int.from_bytes(extracted_bytes[:4], "little")
    salt, nonce, stored_mac = extracted_bytes[4:20], extracted_bytes[20:32], extracted_bytes[32:64]
    
    key = hashlib.pbkdf2_hmac("sha256", password, salt, 200_000, dklen=32)
    
    # Reconstruct Shuffle
    prng = ChaCha20.new(key=key, nonce=nonce)
    def prng_gen_func():
        while True:
            block = prng.encrypt(b"\x00" * 1024)
            for i in range(0, len(block), 4):
                yield int.from_bytes(block[i:i+4], "little")
    
    gen = prng_gen_func()
    indices = list(range(512, len(flat)))
    for i in range(len(indices)-1, 0, -1):
        j = next(gen) % (i+1)
        indices[i], indices[j] = indices[j], indices[i]

    # Extract Ciphertext bits
    cipher_bits = [flat[indices[i]][indices[i] % 3] & 1 for i in range(msg_len * 8)]
    ciphertext = bytearray(int("".join(map(str, cipher_bits[i:i+8])), 2) for i in range(0, len(cipher_bits), 8))

    # Verify HMAC
    if not hmac.compare_digest(hmac.new(key, extracted_bytes[:32] + ciphertext, hashlib.sha256).digest(), bytes(stored_mac)):
        raise ValueError("Integrity check failed: Wrong password or tampered image.")

    return ChaCha20.new(key=key, nonce=nonce).decrypt(ciphertext)

# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/embed', methods=['POST'])
def embed():
    try:
        file = request.files['image']
        msg = request.form['message'].encode()
        pwd = request.form['password']
        result_img = embed_msg_logic(file, msg, pwd)
        return send_file(result_img, mimetype='image/png', as_attachment=True, download_name='stego_image.png')
    except Exception as e:
        # Return JSON error and a 400 status code so JavaScript catches it
        return jsonify({"error": str(e)}), 400

@app.route('/extract', methods=['POST'])
def extract():
    try:
        file = request.files['image']
        pwd = request.form['password']
        decrypted_msg = extract_msg_logic(file, pwd)
        return render_template('index.html', decrypted_text=decrypted_msg.decode())
    except Exception as e:
        flash(f"Error: {str(e)}")
        return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True)