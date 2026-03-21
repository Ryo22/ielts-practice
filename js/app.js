import CONFIG from './config.js';
import TRANSLATIONS from './i18n.js';

class IELTSCoach {
    constructor() {
        this.currentLang = localStorage.getItem('iac_lang') || 'ja';
        this.currentView = 'dashboard';
        this.userSettings = this.loadSettings();
        this.supabase = null;
        this.availableModels = { text: [], audio: [] };
        this.currentTasks = { writing: null, reading: null, speaking: null };
        
        this.init();
    }

    async init() {
        this.applySavedKeys();
        this.initSupabase();
        this.initScoreSelectors();
        this.initAPIFields();
        this.applyFontSize(this.userSettings.FONT_SIZE || 16);
        this.bindEvents();
        this.applyLanguage();
        this.updateView();
        this.calculateOverall();
        
        if (this.getGeminiKey()) {
            await this.fetchModels();
            this.initModelSelectors();
        }
        
        lucide.createIcons();
        await this.loadPracticeHistory();
    }

    loadSettings() {
        const saved = localStorage.getItem('iac_settings');
        const defaultSettings = {
            ...CONFIG.SYSTEM_TARGET,
            MODEL_GEN: 'gemini-1.5-flash-latest',
            MODEL_AUDIO: 'gemini-2.0-flash-exp',
            FONT_SIZE: 16
        };
        try {
            return saved ? JSON.parse(saved) : defaultSettings;
        } catch {
            return defaultSettings;
        }
    }

    saveSettings() {
        localStorage.setItem('iac_settings', JSON.stringify(this.userSettings));
    }

    applySavedKeys() {
        const savedKeys = localStorage.getItem('iac_keys');
        if (savedKeys) {
            const keys = JSON.parse(savedKeys);
            if (keys.gemini) this.userSettings.GEMINI_KEY = keys.gemini;
            if (keys.supabase_url) this.userSettings.SUPABASE_URL = keys.supabase_url;
            if (keys.supabase_key) this.userSettings.SUPABASE_KEY = keys.supabase_key;
        }
    }

    getGeminiKey() { return this.userSettings.GEMINI_KEY || CONFIG.GEMINI_API_KEY; }
    getSupabaseURL() { return this.userSettings.SUPABASE_URL || CONFIG.SUPABASE_URL; }
    getSupabaseKey() { return this.userSettings.SUPABASE_KEY || CONFIG.SUPABASE_ANON_KEY; }

    applyFontSize(size) {
        document.documentElement.style.setProperty('--base-font-size', `${size}px`);
    }

    initAPIFields() {
        const gemInput = document.getElementById('input-gemini-key');
        const urlInput = document.getElementById('input-supabase-url');
        const keyInput = document.getElementById('input-supabase-key');
        if (gemInput) gemInput.value = this.getGeminiKey();
        if (urlInput) urlInput.value = this.getSupabaseURL();
        if (keyInput) keyInput.value = this.getSupabaseKey();
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
        const { L, R, W, S } = this.userSettings;
        const avg = (L + R + W + S) / 4;
        const rounded = Math.round(avg * 4) / 4;
        document.getElementById('target-overall-val').textContent = rounded.toFixed(1);
        const progress = document.getElementById('overall-progress');
        if (progress) progress.style.width = `${(rounded / 9) * 100}%`;
    }

    initSupabase() {
        if (typeof supabase !== 'undefined' && this.getSupabaseURL() && this.getSupabaseKey()) {
            this.supabase = supabase.createClient(this.getSupabaseURL(), this.getSupabaseKey());
        }
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView(item.getAttribute('data-view'));
            });
        });
        document.getElementById('lang-ja')?.addEventListener('click', () => this.switchLanguage('ja'));
        document.getElementById('lang-en')?.addEventListener('click', () => this.switchLanguage('en'));
        ['writing', 'reading', 'speaking'].forEach(skill => {
            document.getElementById(`btn-gen-${skill}`)?.addEventListener('click', () => this.generateProblem(skill));
        });
        document.getElementById('btn-submit-writing')?.addEventListener('click', () => this.handleWritingSubmission());
        document.getElementById('btn-save-keys')?.addEventListener('click', () => this.handleSaveKeys());
        document.getElementById('zoom-in')?.addEventListener('click', () => this.changeZoom(1));
        document.getElementById('zoom-out')?.addEventListener('click', () => this.changeZoom(-1));
        document.getElementById('zoom-reset')?.addEventListener('click', () => this.changeZoom(0));
    }

    changeZoom(delta) {
        let size = this.userSettings.FONT_SIZE || 16;
        size = delta === 0 ? 16 : Math.max(12, Math.min(30, size + delta));
        this.userSettings.FONT_SIZE = size;
        this.applyFontSize(size);
        this.saveSettings();
    }

    handleSaveKeys() {
        const keys = {
            gemini: document.getElementById('input-gemini-key').value.trim(),
            supabase_url: document.getElementById('input-supabase-url').value.trim(),
            supabase_key: document.getElementById('input-supabase-key').value.trim()
        };
        localStorage.setItem('iac_keys', JSON.stringify(keys));
        alert("Saved. Reloading...");
        window.location.reload();
    }

    switchLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('iac_lang', lang);
        this.applyLanguage();
        this.updateView();
        document.getElementById('lang-ja')?.classList.toggle('active', lang === 'ja');
        document.getElementById('lang-en')?.classList.toggle('active', lang === 'en');
    }

    applyLanguage() {
        const trans = TRANSLATIONS[this.currentLang];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (trans[key]) el.textContent = trans[key];
        });
    }

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        document.getElementById(`${view}-view`)?.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-view') === view);
        });
        const trans = TRANSLATIONS[this.currentLang];
        const titleEl = document.getElementById('view-title');
        if (titleEl) titleEl.textContent = trans[`${view}_module`] || trans[view] || view;
        lucide.createIcons();
    }

    updateView() { this.switchView(this.currentView); }

    async fetchModels() {
        const apiKey = this.getGeminiKey();
        if (!apiKey) return;
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await res.json();
            this.availableModels = { text: [], audio: [] };
            data.models.forEach(m => {
                const name = m.name.replace('models/', '');
                if (m.supportedGenerationMethods.includes('generateContent')) this.availableModels.text.push(name);
                if (name.includes('gemini-2.0') || name.includes('flash') || name.includes('audio')) this.availableModels.audio.push(name);
            });
        } catch { this.availableModels = { text: ['gemini-1.5-flash-latest'], audio: ['gemini-2.0-flash-exp'] }; }
    }

    initModelSelectors() {
        const genSelect = document.getElementById('model-gen');
        const audioSelect = document.getElementById('model-audio');
        if (!genSelect || !audioSelect) return;
        genSelect.innerHTML = ''; audioSelect.innerHTML = '';
        this.availableModels.text.forEach(m => genSelect.add(new Option(m, m, m === this.userSettings.MODEL_GEN, m === this.userSettings.MODEL_GEN)));
        this.availableModels.audio.forEach(m => audioSelect.add(new Option(m, m, m === this.userSettings.MODEL_AUDIO, m === this.userSettings.MODEL_AUDIO)));
        genSelect.addEventListener('change', (e) => { this.userSettings.MODEL_GEN = e.target.value; this.saveSettings(); });
        audioSelect.addEventListener('change', (e) => { this.userSettings.MODEL_AUDIO = e.target.value; this.saveSettings(); });
    }

    async generateProblem(skill) {
        const btn = document.getElementById(`btn-gen-${skill}`);
        const originalText = btn.innerHTML;
        try {
            btn.disabled = true; btn.innerHTML = "Generating...";
            const target = this.userSettings[skill === 'writing' ? 'W' : (skill === 'reading' ? 'R' : 'S')];
            
            // Refined CBT Output Format Prompt
            const prompt = `Act as an expert IELTS Examiner. Generate a highly authentic IELTS ${skill} Task. Level: Band ${target}.
            Structure with multiple paragraphs and clear headings.
            FOR READING: Passage and Questions must be separate.
            Return JSON Format: {"title":"(Title)","passage":"(The full passage with \\n)","questions":"(The questions 1-10 with \\n)","prompt":"(Combined for Writing)"}`;
            
            const res = await this.callGemini(prompt, true, this.userSettings.MODEL_GEN);
            this.currentTasks[skill] = res;
            
            if (skill === 'writing') {
                document.getElementById('writing-prompt-title').textContent = res.title;
                document.getElementById('writing-prompt-body').textContent = res.prompt || res.passage || res.questions;
                document.getElementById('btn-submit-writing').disabled = false;
            } else if (skill === 'speaking') {
                document.getElementById('speaking-task-container').classList.remove('hidden');
                document.getElementById('speaking-prompt-title').textContent = res.title;
                document.getElementById('speaking-prompt-body').textContent = res.passage || res.prompt;
            } else if (skill === 'reading') {
                document.getElementById('reading-passage-content').textContent = res.passage;
                document.getElementById('reading-questions-content').textContent = res.questions;
            }
        } catch (err) { alert("Generation failed. Check settings."); }
        finally { btn.disabled = false; btn.innerHTML = originalText; lucide.createIcons(); }
    }

    async callGemini(prompt, isJson = false, model = 'gemini-1.5-flash-latest') {
        const apiKey = this.getGeminiKey();
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, responseMimeType: isJson ? "application/json" : "text/plain" }
            })
        });
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        return isJson ? JSON.parse(text) : text;
    }

    async handleWritingSubmission() {
        const essay = document.getElementById('writing-input').value.trim();
        if (!essay) return;
        const panel = document.getElementById('writing-feedback');
        panel.classList.remove('hidden');
        panel.innerHTML = "Analyzing...";
        try {
            const prompt = `Evaluate ielts essay for Band ${this.userSettings.W}. Return JSON. Essay: "${essay}"`;
            const feedback = await this.callGemini(prompt, true, this.userSettings.MODEL_GEN);
            this.renderFeedback(feedback);
        } catch (err) { panel.innerHTML = "Evaluation error."; }
    }

    renderFeedback(feedback) {
        const panel = document.getElementById('writing-feedback');
        const score = feedback.overall_band || feedback.score || "N/A";
        const getString = (v) => (typeof v === 'string' ? v : (v?.text || v?.summary || JSON.stringify(v)));
        const summary = this.currentLang === 'ja' ? getString(feedback.summary_ja) : getString(feedback.summary_en);
        let html = `<div class="feedback-header"><h3>Band Score: ${score}</h3><p>${summary}</p></div><div class="crit-grid">`;
        if (feedback.criteria) Object.entries(feedback.criteria).forEach(([k, v]) => { html += `<div class="crit-box"><strong>${k.toUpperCase()}: ${v.band || v.score || 'N/A'}</strong><p>${getString(v.feedback || v)}</p></div>`; });
        html += `</div>`;
        panel.innerHTML = html;
        panel.scrollIntoView({ behavior: 'smooth' });
    }

    async loadPracticeHistory() { if (!this.supabase) return; }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new IELTSCoach(); });
