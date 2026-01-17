import os
import hashlib
import hmac
import numpy as np
from flask import Flask, render_template, request, send_file, jsonify
from Crypto.Cipher import ChaCha20
from PIL import Image
import io

app = Flask(__name__, static_url_path="", static_folder=".")
app.secret_key = os.environ.get("SECRET_KEY", "fallback-low-security-key")

def get_key_and_nonce(password_str, salt=None, nonce=None):
    password = password_str.encode()
    salt = salt or os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password, salt, 200_000, dklen=32)
    nonce = nonce or os.urandom(12)
    return key, salt, nonce


def embed_msg_logic(img_file, msg, password_str):
    key, salt, nonce = get_key_and_nonce(password_str)
    cipher = ChaCha20.new(key=key, nonce=nonce)
    ciphertext = cipher.encrypt(msg)
    
    header = len(ciphertext).to_bytes(4, "little") + salt + nonce
    mac = hmac.new(key, header + ciphertext, hashlib.sha256).digest()
    payload_header = header + mac

    img = Image.open(img_file).convert("RGB")
    arr = np.array(img, dtype=np.uint8)
    flat = arr.ravel()
    total_elements = flat.size

    required_bits = (len(payload_header) + len(ciphertext)) * 8
    if required_bits > (total_elements - 1536):
        raise ValueError("Image too small for this message!")

    header_bits = np.unpackbits(np.frombuffer(payload_header, dtype=np.uint8))
    for i in range(len(header_bits)):
        idx = i * 3 + 2
        flat[idx] = (flat[idx] & ~1) | header_bits[i]
    
    seed = int.from_bytes(key[:4], "little")
    rng = np.random.default_rng(seed)
    
    cipher_bits = np.unpackbits(np.frombuffer(ciphertext, dtype=np.uint8))
    num_bits = len(cipher_bits)
    
    target_indices = rng.choice(
        np.arange(1536, total_elements, dtype=np.uint32), 
        size=num_bits, 
        replace=False
    )
    
    flat[target_indices] = (flat[target_indices] & ~1) | cipher_bits

    out_img = Image.fromarray(arr)
    img_io = io.BytesIO()
    out_img.save(img_io, "PNG", optimize=True)
    img_io.seek(0)
    return img_io


def extract_msg_logic(img_file, password_str):
    img = Image.open(img_file).convert("RGB")
    flat = np.array(img, dtype=np.uint8).ravel()
    total_elements = len(flat)

    header_indices = np.arange(2, 1536, 3)
    header_bits = flat[header_indices] & 1
    header_bytes = np.packbits(header_bits).tobytes()
    
    msg_len = int.from_bytes(header_bytes[:4], "little")
    salt, nonce, stored_mac = header_bytes[4:20], header_bytes[20:32], header_bytes[32:64]

    key, _, _ = get_key_and_nonce(password_str, salt, nonce)
    seed = int.from_bytes(key[:4], "little")
    rng = np.random.default_rng(seed)
    
    num_bits = msg_len * 8
    target_indices = rng.choice(
        np.arange(1536, total_elements, dtype=np.uint32), 
        size=num_bits, 
        replace=False
    )
    
    cipher_bits = flat[target_indices] & 1
    ciphertext = np.packbits(cipher_bits).tobytes()

    header_part = header_bytes[:32]
    calculated_mac = hmac.new(key, header_part + ciphertext, hashlib.sha256).digest()
    
    if not hmac.compare_digest(calculated_mac, stored_mac):
        raise ValueError("Integrity check failed: Wrong password or tampered image.")

    return ChaCha20.new(key=key, nonce=nonce).decrypt(ciphertext)


# --- ROUTES ---
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/embed", methods=["POST"])
def embed():
    try:
        file = request.files["image"]
        original_fname = os.path.splitext(file.filename)[0]
        msg = request.form["message"].encode()
        pwd = request.form["password"]
        result_img = embed_msg_logic(file, msg, pwd)
        return send_file(
            result_img,
            mimetype="image/png",
            as_attachment=True,
            download_name="stego_image.png",
        )
    except Exception as e:
        # Return JSON error and a 400 status code so JavaScript catches it
        return jsonify({"error": str(e)}), 400


@app.route('/extract', methods=['POST'])
def extract():
    try:
        file = request.files['image']
        pwd = request.form['password']
        decrypted_msg = extract_msg_logic(file, pwd)
        # Return JSON instead of render_template to prevent page reload
        return jsonify({"decrypted_text": decrypted_msg.decode()})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(debug=True)
