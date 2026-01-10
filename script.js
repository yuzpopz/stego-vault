/* ---------- UTILS ---------- */
function toggleVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        btn.textContent = "[HIDE]";
    } else {
        input.type = "password";
        btn.textContent = "[SHOW]";
    }
}

/* ---------- EMBED FORM LOGIC ---------- */
const embedForm = document.querySelector('form[action="/embed"]');
const embedBtn = document.getElementById('embed-btn');
const embedPwd = document.getElementById('embed-pwd');
const embedInputs = embedForm.querySelectorAll('input, textarea');

const requirements = {
    length: /.{8,}/,
    upper: /[A-Z]/,
    lower: /[a-z]/,
    num: /[0-9]/,
    spec: /[!@#$%^&*(),.?":{}|<>]/
};

function updatePasswordRequirements() {
    const val = embedPwd.value;
    let allValid = true;
    for (const [key, regex] of Object.entries(requirements)) {
        const el = document.getElementById(key);
        const valid = regex.test(val);
        el.className = valid ? 'valid' : 'invalid';
        if (!valid) allValid = false;
    }
    return allValid;
}

function checkEmbedForm() {
    const allFilled = [...embedInputs].every(i =>
        i.type === "file" ? i.files.length > 0 : i.value.trim() !== ""
    );
    const pwdValid = updatePasswordRequirements();
    embedBtn.disabled = !(allFilled && pwdValid);
}

embedPwd.addEventListener('input', () => {
    updatePasswordRequirements();
    checkEmbedForm();
});

embedInputs.forEach(input => {
    if (input !== embedPwd) input.addEventListener('input', checkEmbedForm);
});

/* ---------- EXTRACT FORM LOGIC ---------- */
const extractForm = document.querySelector('form[action="/extract"]');
const extractBtn = document.getElementById('extract-btn');
const extractInputs = extractForm.querySelectorAll('input');

function checkExtractForm() {
    const allFilled = [...extractInputs].every(i =>
        i.type === "file" ? i.files.length > 0 : i.value.trim() !== ""
    );
    extractBtn.disabled = !allFilled;
}

extractInputs.forEach(input => input.addEventListener('input', checkExtractForm));

const defaultFileText = 'DRAG & DROP HERE / <br class="mobile-only">CLICK TO SELECT';

/* ---------- FILE DROP HANDLERS ---------- */
document.querySelectorAll('.file-drop').forEach(drop => {
    const input = document.getElementById(drop.dataset.input);
    const text = drop.querySelector('.file-text');
    const preview = drop.querySelector('.preview-img');

    const showError = (msg) => {
        text.textContent = msg;
        drop.classList.add('invalid');
        drop.classList.remove('selected');

        if(preview) preview.style.display = 'none';

        input.value = "";
        input.dispatchEvent(new Event('input'));

        setTimeout(() => {
            text.innerHTML = defaultFileText;
            drop.classList.remove('invalid');
        }, 2500);
    };

    const handleFile = (file) => {
        if (!file) return false;

        clearPreviousResults();

        const fileName = file.name.toLowerCase();
        const allowedExtensions = [
            '.tiff', '.jfif', '.bmp', '.gif', '.png', '.webp', '.jpg',
            '.jpeg', '.ico', '.xbm', '.dib', '.pjp', '.tif', '.pjpeg', '.avif'
        ];
        const isAllowedType = allowedExtensions.some(ext => fileName.endsWith(ext));

        if (input.id === "extract-image" && file.type !== "image/png") {
            showError("ONLY PNG FILES ALLOWED!");
            return false;
        }

        if (input.id === "embed-image") {
            if (!file.type.startsWith("image/")) {
                showError("ONLY IMAGE FILES ALLOWED!");
                return false;
            }
            else if (!isAllowedType) {
                showError("UNSUPPORTED IMAGE FORMAT!");
                return false;
            }
        }

        if (input.id === "extract-image") {
            const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
            localStorage.setItem('stego_filename', nameWithoutExt);
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);

        text.textContent = "> " + file.name.toUpperCase();
        drop.classList.add('selected');

        input.dispatchEvent(new Event('input'));
        return true;
    };

    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { 
        if (input.files && input.files.length > 0) {
            handleFile(input.files[0]); 
        } else {
            text.innerHTML = defaultFileText;
            drop.classList.remove('selected');
            drop.classList.remove('invalid');
    
            if (preview) {
                preview.src = "";
                preview.style.display = 'none';
            }
            input.value = ""; 
            input.dispatchEvent(new Event('input')); 
        }
    });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            const file = e.dataTransfer.files[0];
            if (handleFile(file)) input.files = e.dataTransfer.files;
        }
    });
});

/* ---------- LOADING & AJAX ---------- */
const overlay = document.getElementById('loading-overlay');
const loaderMsg = document.getElementById('loader-msg');
const errorContainer = document.getElementById('error-container');

function showLoading(message) {
    loaderMsg.innerHTML = message;
    overlay.style.display = 'flex';
}

function hideLoading() { overlay.style.display = 'none'; }
function showUIError(msg) { errorContainer.innerHTML = `<div class="alert">${msg.toUpperCase()}</div>`; }

function clearPreviousResults() {
    errorContainer.innerHTML = '';
    const resultBox = document.querySelector('.result-box');
    if (resultBox) {
        resultBox.remove();
    }
}

embedForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearPreviousResults();

    const fileInput = document.getElementById('embed-image');
    const originalName = fileInput.files[0].name.replace(/\.[^/.]+$/, "");

    showLoading("ENCRYPTING & EMBEDDING. <br class='mobile-only'>PLEASE WAIT ...");
    const formData = new FormData(this);
    try {
        const response = await fetch('/embed', { method: 'POST', body: formData });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${originalName}_embedded.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            hideLoading();
        } else {
            const errorData = await response.json();
            hideLoading();
            showUIError(errorData.error);
        }
    } catch (error) {
        hideLoading();
        showUIError("CONNECTION ERROR: COULD NOT REACH SERVER.");
    }
});

/* ---------- UPDATED EXTRACT FORM LOGIC ---------- */
extractForm.addEventListener('submit', async function (e) {
    e.preventDefault(); // This stops the browser tab from showing 'loading'
    clearPreviousResults();
    showLoading("DECRYPTING & EXTRACTING. <br class='mobile-only'>PLEASE WAIT ...");

    const formData = new FormData(this);

    // Capture filename for the download button later
    const fileInput = document.getElementById('extract-image');
    const originalName = fileInput.files[0].name.replace(/\.[^/.]+$/, "");

    try {
        const response = await fetch('/extract', { method: 'POST', body: formData });
        const data = await response.json();

        if (response.ok) {
            hideLoading();

            let resultBox = document.querySelector('.result-box');
            if (!resultBox) {
                const section = extractForm.parentElement;
                const isDesktop = window.innerWidth > 768;
                const lmargin = isDesktop ? '5px' : '0px';

                resultBox = document.createElement('div');
                resultBox.className = 'result-box';
                resultBox.innerHTML = `
                    <label style="color: var(--accent); margin-top: -5px">Result:</label>
                    <div id="short-result" style="margin-bottom: 12px; overflow-wrap: break-word; word-break: normal;"></div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button id="download-btn" class="download-btn">Download Full Text</button>
                        <button id="copy-btn" class="download-btn" style="margin-left: ${lmargin}">Copy to Clipboard</button>
                    </div>
                `;
                section.appendChild(resultBox);
            }

            const fullText = data.decrypted_text;
            const shortResultEl = document.getElementById('short-result');
            const maxLength = 980;

            if (fullText.length <= maxLength) {
                shortResultEl.textContent = fullText;
            } else {
                shortResultEl.textContent = fullText.slice(0, maxLength) + ` ... [${fullText.length - maxLength} CHARACTERS REMAINING]`;
            }

            const downloadBtn = document.getElementById('download-btn');
            // Remove old listeners by cloning or just overwriting the function
            const newDownloadBtn = downloadBtn.cloneNode(true);
            downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);

            newDownloadBtn.addEventListener('click', () => {
                const blob = new Blob([fullText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${originalName}_extracted.txt`; // Dynamic filename
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            });

            const copyBtn = document.getElementById('copy-btn');
            const newCopyBtn = copyBtn.cloneNode(true);
            copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);

            newCopyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(fullText);
                    const originalText = newCopyBtn.textContent;
                    newCopyBtn.textContent = "COPIED!";

                    setTimeout(() => {
                        newCopyBtn.textContent = originalText;
                        newCopyBtn.style.borderColor = "var(--accent)";
                    }, 2000);
                } catch (err) {
                    showUIError("FAILED TO COPY TEXT.");
                }
            });

            setTimeout(() => {
                window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);

        } else {
            hideLoading();
            showUIError(data.error);
        }
    } catch (error) {
        hideLoading();
        showUIError("CONNECTION ERROR: COULD NOT REACH SERVER.");
    }
});

window.addEventListener('pageshow', (event) => { if (event.persisted) hideLoading(); });

const canvas = document.getElementById('canvas-bg');
const ctx = canvas.getContext('2d');

let particles = [];
const mouse = { x: null, y: null, radius: 250 };

window.addEventListener('mousemove', (e) => {
    mouse.x = e.x;
    mouse.y = e.y;
});

function init() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    particles = [];
    // Create 80 geometric nodes
    for (let i = 0; i < 150; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2 + 1.5,
            speedX: (Math.random() - 0.5) * 0.5,
            speedY: (Math.random() - 0.5) * 0.5
        });
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
        p.x += p.speedX;
        p.y += p.speedY;

        // Bounce off edges
        if (p.x > canvas.width || p.x < 0) p.speedX *= -1;
        if (p.y > canvas.height || p.y < 0) p.speedY *= -1;

        // Draw particle (small squares for tech look)
        ctx.fillStyle = '#00ff41'; // Your var(--accent)
        ctx.fillRect(p.x, p.y, p.size, p.size);

        // Interaction Logic
        let dx = mouse.x - p.x;
        let dy = mouse.y - p.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouse.radius) {
            ctx.strokeStyle = `rgba(0, 255, 65, ${1 - distance / mouse.radius})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
        }
    });
    requestAnimationFrame(animate);
}

window.addEventListener('resize', init);
init();
animate();

