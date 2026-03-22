import CONFIG from './config.js';
import TRANSLATIONS from './i18n.js';

class IELTSCoach {
    constructor() {
        this.currentLang = localStorage.getItem('iac_lang') || 'ja';
        this.currentView = 'dashboard';
        this.userSettings = this.loadSettings();
        
        // Speaking Session States
        this.speakingPhase = 'IDLE'; // IDLE, PART1, PART2_PREP, PART2_SPEAK, PART3, FINISH
        this.speakingHistory = [];
        this.isRecording = false;
        this.recognition = null;
        this.timerInterval = null;
        this.prepTimer = 60;
        
        this.init();
    }

    async init() {
        this.applySavedKeys();
        this.initAPIFields();
        this.initScoreSelectors();
        this.applyFontSize(this.userSettings.FONT_SIZE || 16);
        this.initSpeechRecognition();
        this.bindEvents();
        this.updateView();
        this.calculateOverall();
        if (this.getGeminiKey()) this.fetchModels();
        lucide.createIcons();
    }

    loadSettings() {
        const saved = localStorage.getItem('iac_settings');
        return saved ? JSON.parse(saved) : { ...CONFIG.SYSTEM_TARGET, MODEL_GEN: 'gemini-1.5-flash-latest', MODEL_AUDIO: 'gemini-2.0-flash-exp', FONT_SIZE: 16 };
    }

    saveSettings() { localStorage.setItem('iac_settings', JSON.stringify(this.userSettings)); }
    applySavedKeys() { const k = localStorage.getItem('iac_keys'); if (k) { const keys = JSON.parse(k); if (keys.gemini) this.userSettings.GEMINI_KEY = keys.gemini; } }
    getGeminiKey() { return this.userSettings.GEMINI_KEY || CONFIG.GEMINI_API_KEY; }

    applyFontSize(s) { document.documentElement.style.setProperty('--base-font-size', `${s}px`); }

    initScoreSelectors() {
        ['l', 'r', 'w', 's'].forEach(skill => {
            const select = document.getElementById(`target-${skill}`);
            if (!select) return;
            select.innerHTML = '';
            for (let i = 4.0; i <= 9.0; i += 0.5) {
                const opt = new Option(i.toFixed(1), i.toFixed(1));
                if (parseFloat(this.userSettings[skill.toUpperCase()]) === i) opt.selected = true;
                select.add(opt);
            }
            select.addEventListener('change', (e) => { this.userSettings[skill.toUpperCase()] = parseFloat(e.target.value); this.saveSettings(); this.calculateOverall(); });
        });
    }

    calculateOverall() {
        const avg = ['L','R','W','S'].reduce((s, d) => s + (this.userSettings[d] || 0), 0) / 4;
        document.getElementById('target-overall-val').textContent = (Math.round(avg * 4) / 4).toFixed(1);
    }

    initAPIFields() { const i = document.getElementById('input-gemini-key'); if (i) i.value = this.getGeminiKey(); }

    initSpeechRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return alert("Speech Recognition not supported in this browser.");
        this.recognition = new SR();
        this.recognition.continuous = false;
        this.recognition.lang = 'en-US';
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
             this.setMicUI(true, 'LISTENING...');
        };

        this.recognition.onresult = (e) => {
            const t = Array.from(e.results).map(r => r[0].transcript).join('');
            document.getElementById('user-transcript').textContent = t;
            if (e.results[0].isFinal) {
                this.isRecording = false;
                this.handleUserVoiceInput(t);
            }
        };

        this.recognition.onend = () => {
            if (this.isRecording) {
                this.recognition.start(); // Keep alive if we expect response
            } else {
                this.setMicUI(false, 'WAITING...');
            }
        };

        this.recognition.onerror = () => { this.isRecording = false; this.setMicUI(false, 'MIC ERROR'); };
    }

    setMicUI(active, text) {
        const btn = document.getElementById('btn-mic');
        const status = document.getElementById('mic-status');
        const label = document.getElementById('mic-label');
        if (active) {
            btn.classList.add('recording');
            status.classList.remove('hidden');
        } else {
            btn.classList.remove('recording');
            status.classList.add('hidden');
        }
        if (label) label.textContent = text;
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', (e) => { e.preventDefault(); this.switchView(i.getAttribute('data-view')); }));
        document.getElementById('btn-start-speaking')?.addEventListener('click', () => this.startSpeakingTest());
        document.getElementById('btn-mic')?.addEventListener('click', () => this.toggleMicManual());
        document.getElementById('btn-next-phase')?.addEventListener('click', () => this.transitionSpeakingPhase());
        
        // Timer & Generation
        document.getElementById('btn-gen-writing')?.addEventListener('click', () => this.generateProblem('writing'));
        document.getElementById('btn-gen-reading')?.addEventListener('click', () => this.generateProblem('reading'));
        document.getElementById('btn-submit-writing')?.addEventListener('click', () => this.handleWritingSubmission());
        document.getElementById('writing-input')?.addEventListener('input', (e) => {
            const c = e.target.value.trim() ? e.target.value.trim().split(/\s+/).length : 0;
            document.getElementById('word-count-val').textContent = c;
        });

        // Utils
        document.getElementById('zoom-in')?.addEventListener('click', () => this.changeZoom(1));
        document.getElementById('zoom-out')?.addEventListener('click', () => this.changeZoom(-1));
        document.getElementById('btn-save-keys')?.addEventListener('click', () => {
            localStorage.setItem('iac_keys', JSON.stringify({ gemini: document.getElementById('input-gemini-key').value }));
            window.location.reload();
        });
    }

    changeZoom(d) {
        let s = this.userSettings.FONT_SIZE || 16;
        s = Math.max(12, Math.min(28, s + d));
        this.userSettings.FONT_SIZE = s;
        this.applyFontSize(s);
        this.saveSettings();
    }

    switchView(v) {
        this.currentView = v;
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        document.getElementById(`${v}-view`)?.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.getAttribute('data-view') === v));
        lucide.createIcons();
    }

    // SPEAKING FLOW LOGIC
    async startSpeakingTest() {
        this.speakingPhase = 'PART1';
        this.speakingHistory = [];
        document.getElementById('btn-start-speaking').classList.add('hidden');
        document.getElementById('btn-next-phase').classList.remove('hidden');
        document.getElementById('speaking-phase-indicator').textContent = "PART 1: INTRODUCTION & INTERVIEW";
        
        const introMsg = "Good day, I'm your examiner for today. We'll start with Part 1. Can you tell me your full name and what you currently do?";
        this.examinerSpeak(introMsg);
        this.speakingHistory.push({ role: 'model', parts: [{ text: introMsg }] });
    }

    async transitionSpeakingPhase() {
        if (this.speakingPhase === 'PART1') {
            this.speakingPhase = 'PART2_PREP';
            document.getElementById('speaking-phase-indicator').textContent = "PART 2: LONG TURN (PREPARATION)";
            document.getElementById('cbt-cue-card').classList.remove('hidden');
            
            // Generate Cue Card
            const res = await this.callGemini("Generate a realistic IELTS Speaking Part 2 Cue Card. Return JSON: {topic, prompts: []}", true);
            let html = `<strong>Topic: ${res.topic}</strong><ul>`;
            res.prompts.forEach(p => html += `<li>${p}</li>`);
            html += `</ul><p>You should say for 1 to 2 minutes.</p>`;
            document.getElementById('cue-card-content').innerHTML = html;
            
            const msg = "Now for Part 2, I'm going to give you a topic. You'll have one minute to prepare. Here is your cue card.";
            this.examinerSpeak(msg);
            
            // Wait for examiner speech to finish then start prep timer
            setTimeout(() => this.startPrepTimer(), 4000);

        } else if (this.speakingPhase === 'PART2_SPEAK') {
            this.speakingPhase = 'PART3';
            document.getElementById('speaking-phase-indicator').textContent = "PART 3: DISCUSSION";
            document.getElementById('cbt-cue-card').classList.add('hidden');
            const msg = "Thank you. Now let's move on to Part 3. I'd like to ask you some more general questions related to the topic we've been discussing.";
            this.examinerSpeak(msg);
        }
    }

    startPrepTimer() {
        document.getElementById('prep-timer-area').classList.remove('hidden');
        let count = 60;
        const el = document.getElementById('prep-timer');
        const interval = setInterval(() => {
            count--;
            el.textContent = count;
            if (count <= 0) {
                clearInterval(interval);
                this.speakingPhase = 'PART2_SPEAK';
                document.getElementById('speaking-phase-indicator').textContent = "PART 2: LONG TURN (SPEAKING)";
                this.examinerSpeak("All right, your preparation time is up. Please start speaking now.");
            }
        }, 1000);
    }

    toggleMicManual() {
        if (this.isRecording) {
            this.isRecording = false;
            this.recognition.stop();
        } else {
            this.isRecording = true;
            this.recognition.start();
        }
    }

    async handleUserVoiceInput(transcript) {
        if (!transcript || this.speakingPhase === 'PART2_PREP') return;
        
        this.speakingHistory.push({ role: 'user', parts: [{ text: transcript }] });
        
        const contextPrompt = `You are an IELTS Examiner. 
        Current Phase: ${this.speakingPhase}. 
        Target Band: ${this.userSettings.S}.
        Current History: ${JSON.stringify(this.speakingHistory)}.
        Instruction: Stay in character as a professional examiner. If Part 1, ask follow-up questions. If Part 2 Speaking finished, encourage or transition. If Part 3, dig deeper.`;

        try {
            const aiRes = await this.callGemini(contextPrompt, false, this.userSettings.MODEL_AUDIO);
            this.speakingHistory.push({ role: 'model', parts: [{ text: aiRes }] });
            this.examinerSpeak(aiRes);
        } catch (err) {
            console.error(err);
        }
    }

    examinerSpeak(text) {
        window.speechSynthesis.cancel();
        document.getElementById('examiner-text').textContent = text;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-GB';
        u.rate = 0.95;
        
        u.onstart = () => {
             document.getElementById('examiner-status').classList.remove('hidden');
             document.getElementById('btn-mic').disabled = true;
        };
        u.onend = () => {
             document.getElementById('examiner-status').classList.add('hidden');
             document.getElementById('btn-mic').disabled = false;
             // Auto-start listening after AI speaks, if not in prep phase
             if (this.speakingPhase !== 'PART2_PREP') {
                  this.isRecording = true;
                  this.recognition.start();
             }
        };
        window.speechSynthesis.speak(u);
    }

    // OTHER SECTIONS
    async generateProblem(skill) {
        const btn = document.getElementById(`btn-gen-${skill}`);
        const original = btn.innerHTML;
        try {
            btn.disabled = true; btn.innerHTML = "Generating...";
            if (skill === 'writing') this.startGlobalTimer();
            const res = await this.callGemini(`Generate IELTS ${skill} Task. Academic level. JSON: {title, passage, questions, prompt}`, true);
            if (skill === 'writing') {
                document.getElementById('writing-prompt-title').textContent = res.title;
                document.getElementById('writing-prompt-body').textContent = res.prompt || res.passage;
                document.getElementById('btn-submit-writing').disabled = false;
            } else {
                document.getElementById('reading-passage-content').textContent = res.passage;
                document.getElementById('reading-questions-content').textContent = res.questions;
            }
        } catch(err) { alert("Check API Connection."); }
        finally { btn.disabled = false; btn.innerHTML = original; }
    }

    startGlobalTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        let time = 3600;
        const el = document.getElementById('cbt-timer');
        this.timerInterval = setInterval(() => {
            time--;
            const m = Math.floor(time / 60); const s = time % 60;
            el.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            if (time <= 0) clearInterval(this.timerInterval);
        }, 1000);
    }

    async handleWritingSubmission() {
        const doc = document.getElementById('writing-input').value;
        const fbRes = await this.callGemini(`IELTS Evaluator. Essay: ${doc}. Evaluate for Band ${this.userSettings.W}. JSON: {overall_band, summary_ja}`, true);
        const fbArea = document.getElementById('writing-feedback');
        fbArea.classList.remove('hidden');
        fbArea.innerHTML = `<h3>Evaluation Score: ${fbRes.overall_band}</h3><p>${fbRes.summary_ja}</p>`;
    }

    async callGemini(p, j = false, m = 'gemini-1.5-flash-latest') {
        const key = this.getGeminiKey();
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: j?0.4:0.9, responseMimeType: j?"application/json":"text/plain" } })
        });
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        return j ? JSON.parse(text) : text;
    }

    async fetchModels() {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.getGeminiKey()}`);
            const data = await res.json();
            this.availableModels.text = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent')).map(m => m.name.replace('models/', ''));
        } catch { this.availableModels.text = ['gemini-1.5-flash-latest']; }
    }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new IELTSCoach(); });
