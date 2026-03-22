import CONFIG from './config.js';
import TRANSLATIONS from './i18n.js';

class IELTSCoach {
    constructor() {
        this.currentLang = localStorage.getItem('iac_lang') || 'ja';
        this.currentView = 'dashboard';
        this.userSettings = this.loadSettings();
        this.availableModels = { text: [], audio: [] };
        this.currentTasks = { writing: null, reading: null, speaking: null };
        this.recognition = null;
        this.timerInterval = null;
        this.isRecording = false;
        this.speakingHistory = [];
        
        this.init();
    }

    async init() {
        this.applySavedKeys();
        this.initScoreSelectors();
        this.initAPIFields();
        this.applyFontSize(this.userSettings.FONT_SIZE || 16);
        this.initSpeechAPI();
        this.bindEvents();
        this.updateView();
        this.calculateOverall();
        
        if (this.getGeminiKey()) {
            await this.fetchModels();
        }
        
        lucide.createIcons();
    }

    loadSettings() {
        const saved = localStorage.getItem('iac_settings');
        return saved ? JSON.parse(saved) : { ...CONFIG.SYSTEM_TARGET, MODEL_GEN: 'gemini-1.5-flash-latest', MODEL_AUDIO: 'gemini-2.0-flash-exp', FONT_SIZE: 16 };
    }

    saveSettings() { localStorage.setItem('iac_settings', JSON.stringify(this.userSettings)); }

    applySavedKeys() {
        const savedKeys = localStorage.getItem('iac_keys');
        if (savedKeys) {
            const keys = JSON.parse(savedKeys);
            if (keys.gemini) this.userSettings.GEMINI_KEY = keys.gemini;
        }
    }

    getGeminiKey() { return this.userSettings.GEMINI_KEY || CONFIG.GEMINI_API_KEY; }

    applyFontSize(size) { document.documentElement.style.setProperty('--base-font-size', `${size}px`); }

    initAPIFields() {
        const gemInput = document.getElementById('input-gemini-key');
        if (gemInput) gemInput.value = this.getGeminiKey();
    }

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
            select.addEventListener('change', (e) => {
                this.userSettings[skill.toUpperCase()] = parseFloat(e.target.value);
                this.saveSettings();
                this.calculateOverall();
            });
        });
    }

    calculateOverall() {
        const dims = ['L', 'R', 'W', 'S'];
        const avg = dims.reduce((sum, d) => sum + (this.userSettings[d] || 0), 0) / 4;
        const rounded = Math.round(avg * 4) / 4;
        document.getElementById('target-overall-val').textContent = rounded.toFixed(1);
    }

    initSpeechAPI() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.lang = 'en-US';
            this.recognition.interimResults = true;
            this.recognition.onstart = () => { document.getElementById('mic-status').classList.remove('hidden'); document.body.classList.add('recording'); };
            this.recognition.onend = () => { document.getElementById('mic-status').classList.add('hidden'); document.body.classList.remove('recording'); this.isRecording = false; };
            this.recognition.onresult = (e) => {
                const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
                document.getElementById('user-transcript').textContent = transcript;
                if (e.results[0].isFinal) this.handleUserVoiceInput(transcript);
            };
        }
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => { e.preventDefault(); this.switchView(item.getAttribute('data-view')); });
        });
        document.getElementById('btn-gen-writing')?.addEventListener('click', () => { this.startTimer(); this.generateProblem('writing'); });
        document.getElementById('btn-gen-reading')?.addEventListener('click', () => { this.startTimer(); this.generateProblem('reading'); });
        document.getElementById('writing-input')?.addEventListener('input', (e) => this.updateWordCount(e.target.value));
        document.getElementById('btn-submit-writing')?.addEventListener('click', () => this.handleWritingSubmission());
        document.getElementById('btn-start-speaking')?.addEventListener('click', () => this.startSpeakingTest());
        document.getElementById('btn-mic')?.addEventListener('click', () => this.toggleMic());
        document.getElementById('zoom-in')?.addEventListener('click', () => this.changeZoom(1));
        document.getElementById('zoom-out')?.addEventListener('click', () => this.changeZoom(-1));
        document.getElementById('btn-save-keys')?.addEventListener('click', () => this.handleSaveKeys());
    }

    startTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        let time = 60 * 60;
        const el = document.getElementById('cbt-timer');
        this.timerInterval = setInterval(() => {
            time--;
            const m = Math.floor(time / 60); const s = time % 60;
            el.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            if (time <= 0) clearInterval(this.timerInterval);
        }, 1000);
    }

    updateWordCount(t) {
        const count = t.trim() ? t.trim().split(/\s+/).length : 0;
        document.getElementById('word-count-val').textContent = count;
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
        document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.getAttribute('data-view') === v));
        lucide.createIcons();
    }

    async fetchModels() {
        const key = this.getGeminiKey();
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            const data = await res.json();
            this.availableModels.text = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent')).map(m => m.name.replace('models/', ''));
        } catch { this.availableModels.text = ['gemini-1.5-flash-latest']; }
    }

    async generateProblem(skill) {
        const btn = document.getElementById(`btn-gen-${skill}`);
        const original = btn.innerHTML;
        try {
            btn.disabled = true; btn.innerHTML = "...";
            const target = this.userSettings[skill === 'reading' ? 'R' : 'W'];
            const pool = {
                reading: ["Psychology of memory", "Vertical farming", "Silicon Valley History", "Deep Sea Mining", "Renaissance Art"],
                writing: ["Global Poverty vs. Wealth", "Technology in Education", "Remote Work Evolution", "Urban Migration Impacts"]
            };
            const topic = pool[skill][Math.floor(Math.random() * pool[skill].length)];
            const prompt = `Act as IELTS Examiner. Generate ${skill} Task. Topic: ${topic}. Band: ${target}. Return JSON: {title, passage, questions, prompt}`;
            const res = await this.callGemini(prompt, true);
            this.currentTasks[skill] = res;
            if (skill === 'writing') {
                document.getElementById('writing-prompt-title').textContent = res.title;
                document.getElementById('writing-prompt-body').textContent = res.prompt || res.passage;
                document.getElementById('btn-submit-writing').disabled = false;
            } else if (skill === 'reading') {
                document.getElementById('reading-passage-content').textContent = res.passage;
                document.getElementById('reading-questions-content').textContent = res.questions;
            }
        } catch { alert("Failed. Check Key."); }
        finally { btn.disabled = false; btn.innerHTML = original; }
    }

    async callGemini(p, j = false, m = 'gemini-1.5-flash-latest') {
        const key = this.getGeminiKey();
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: 0.8, responseMimeType: j ? "application/json" : "text/plain" } })
        });
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        return j ? JSON.parse(text) : text;
    }

    async startSpeakingTest() {
        this.speakingHistory = [];
        document.getElementById('btn-mic').disabled = false;
        const msg = "Good day, I'm your examiner. Let's start Part 1. Can you tell me your name?";
        this.examinerSpeak(msg);
        this.speakingHistory.push({ role: 'model', parts: [{ text: msg }] });
    }

    toggleMic() { if (this.isRecording) { this.recognition.stop(); } else { this.recognition.start(); this.isRecording = true; } }

    async handleUserVoiceInput(t) {
        this.speakingHistory.push({ role: 'user', parts: [{ text: t }] });
        const aiMessage = await this.callGemini(`IELTS Examiner. Based on: ${JSON.stringify(this.speakingHistory)}, continue test.`, false);
        this.speakingHistory.push({ role: 'model', parts: [{ text: aiMessage }] });
        this.examinerSpeak(aiMessage);
    }

    examinerSpeak(t) {
        document.getElementById('examiner-text').textContent = t;
        const u = new SpeechSynthesisUtterance(t); u.lang = 'en-GB';
        u.onstart = () => document.getElementById('examiner-status').classList.remove('hidden');
        u.onend = () => document.getElementById('examiner-status').classList.add('hidden');
        window.speechSynthesis.speak(u);
    }

    async handleWritingSubmission() {
        const doc = document.getElementById('writing-input').value;
        const fbRes = await this.callGemini(`IELTS Evaluator. Essay: ${doc}. Return JSON score and summary.`, true);
        const fbArea = document.getElementById('writing-feedback');
        fbArea.classList.remove('hidden');
        fbArea.innerHTML = `<h3>Score: ${fbRes.overall_band || fbRes.score}</h3><p>${fbRes.summary_ja || "評定完了"}</p>`;
    }

    handleSaveKeys() { localStorage.setItem('iac_keys', JSON.stringify({ gemini: document.getElementById('input-gemini-key').value })); window.location.reload(); }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new IELTSCoach(); });
