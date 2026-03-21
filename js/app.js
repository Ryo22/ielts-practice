import CONFIG from './config.js';
import TRANSLATIONS from './i18n.js';

class IELTSCoach {
    constructor() {
        this.currentLang = localStorage.getItem('iac_lang') || 'ja';
        this.currentView = 'dashboard';
        this.userSettings = this.loadSettings();
        this.supabase = null;
        this.availableModels = [];
        this.currentTasks = { writing: null, reading: null, speaking: null };
        
        this.init();
    }

    async init() {
        this.applySavedKeys(); // Apply keys from storage
        this.initSupabase();
        this.initScoreSelectors();
        this.initAPIFields(); // Set UI values
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

    applySavedKeys() {
        // Load custom keys from storage and override CONFIG if present
        const savedKeys = localStorage.getItem('iac_keys');
        if (savedKeys) {
            const keys = JSON.parse(savedKeys);
            if (keys.gemini) this.userSettings.GEMINI_KEY = keys.gemini;
            if (keys.supabase_url) this.userSettings.SUPABASE_URL = keys.supabase_url;
            if (keys.supabase_key) this.userSettings.SUPABASE_KEY = keys.supabase_key;
        }
    }

    getGeminiKey() {
        return this.userSettings.GEMINI_KEY || CONFIG.GEMINI_API_KEY;
    }

    getSupabaseURL() {
        return this.userSettings.SUPABASE_URL || CONFIG.SUPABASE_URL;
    }

    getSupabaseKey() {
        return this.userSettings.SUPABASE_KEY || CONFIG.SUPABASE_ANON_KEY;
    }

    initAPIFields() {
        const gemInput = document.getElementById('input-gemini-key');
        const urlInput = document.getElementById('input-supabase-url');
        const keyInput = document.getElementById('input-supabase-key');
        if (gemInput) gemInput.value = this.getGeminiKey();
        if (urlInput) urlInput.value = this.getSupabaseURL();
        if (keyInput) keyInput.value = this.getSupabaseKey();
    }

    loadSettings() {
        const saved = localStorage.getItem('iac_settings');
        const defaultSettings = {
            ...CONFIG.SYSTEM_TARGET,
            MODEL_GEN: 'gemini-1.5-flash-latest',
            MODEL_EVAL: 'gemini-1.5-pro-latest'
        };
        return saved ? JSON.parse(saved) : defaultSettings;
    }

    saveSettings() {
        localStorage.setItem('iac_settings', JSON.stringify(this.userSettings));
    }

    async fetchModels() {
        const apiKey = this.getGeminiKey();
        if (!apiKey) return;
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("Could not fetch models");
            const data = await res.json();
            // Filter only generateContent supported models
            this.availableModels = data.models
                .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                .map(m => m.name.replace('models/', ''));
            
            console.log("Available Gemini Models:", this.availableModels);
        } catch (err) {
            console.warn("Model fetch failed, using defaults:", err.message);
            this.availableModels = ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-2.0-flash-exp'];
        }
    }

    initModelSelectors() {
        const genSelect = document.getElementById('model-gen');
        const evalSelect = document.getElementById('model-eval');
        if (!genSelect || !evalSelect) return;

        this.availableModels.forEach(m => {
            const opt1 = new Option(m, m);
            const opt2 = new Option(m, m);
            if (m === this.userSettings.MODEL_GEN) opt1.selected = true;
            if (m === this.userSettings.MODEL_EVAL) opt2.selected = true;
            genSelect.add(opt1);
            evalSelect.add(opt2);
        });

        genSelect.addEventListener('change', (e) => {
            this.userSettings.MODEL_GEN = e.target.value;
            this.saveSettings();
        });
        evalSelect.addEventListener('change', (e) => {
            this.userSettings.MODEL_EVAL = e.target.value;
            this.saveSettings();
        });
    }

    initScoreSelectors() {
        ['l', 'r', 'w', 's'].forEach(skill => {
            const select = document.getElementById(`target-${skill}`);
            if (!select) return;
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
        let final = rounded;
        if (rounded % 1 === 0.25 || rounded % 1 === 0.75) final += 0.25;
        document.getElementById('target-overall-val').textContent = final.toFixed(1);
        const progress = document.getElementById('overall-progress');
        if (progress) progress.style.width = `${(final / 9) * 100}%`;
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

        document.getElementById('lang-ja').addEventListener('click', () => this.switchLanguage('ja'));
        document.getElementById('lang-en').addEventListener('click', () => this.switchLanguage('en'));

        ['writing', 'reading', 'speaking'].forEach(skill => {
            document.getElementById(`btn-gen-${skill}`)?.addEventListener('click', () => this.generateProblem(skill));
        });

        document.getElementById('btn-submit-writing')?.addEventListener('click', () => this.handleWritingSubmission());
        
        // Key Saving
        document.getElementById('btn-save-keys')?.addEventListener('click', () => this.handleSaveKeys());
    }

    handleSaveKeys() {
        const keys = {
            gemini: document.getElementById('input-gemini-key').value.trim(),
            supabase_url: document.getElementById('input-supabase-url').value.trim(),
            supabase_key: document.getElementById('input-supabase-key').value.trim()
        };
        localStorage.setItem('iac_keys', JSON.stringify(keys));
        alert("API credentials saved! The app will reload to apply changes.");
        window.location.reload();
    }

    switchLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('iac_lang', lang);
        this.applyLanguage();
        this.updateView();
        document.getElementById('lang-ja').classList.toggle('active', lang === 'ja');
        document.getElementById('lang-en').classList.toggle('active', lang === 'en');
        document.documentElement.lang = lang;
        lucide.createIcons();
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
        document.getElementById(`${view}-view`).classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-view') === view);
        });
        const trans = TRANSLATIONS[this.currentLang];
        document.getElementById('view-title').textContent = trans[`${view}_module`] || trans[view] || view;
        lucide.createIcons();
    }

    updateView() {
        this.switchView(this.currentView);
    }

    async generateProblem(skill) {
        const btn = document.getElementById(`btn-gen-${skill}`);
        const originalContent = btn.innerHTML;
        try {
            btn.disabled = true;
            btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> AI Generating...`;
            lucide.createIcons();

            const prompt = `Generate a professional IELTS ${skill.toUpperCase()} task. Target Band: ${this.userSettings[skill === 'writing' ? 'W' : (skill === 'reading' ? 'R' : 'S')]}. Return JSON: {"title":"...","prompt":"...","tips":"..."}`;
            // Use MODEL_GEN from settings
            const res = await this.callGemini(prompt, true, this.userSettings.MODEL_GEN);
            this.currentTasks[skill] = res;

            if (skill === 'writing') {
                document.getElementById('writing-task-container').classList.remove('hidden');
                document.getElementById('writing-prompt-title').textContent = res.title;
                document.getElementById('writing-prompt-body').textContent = res.prompt;
                document.getElementById('btn-submit-writing').disabled = false;
            } else if (skill === 'reading') {
                document.getElementById('reading-content').innerHTML = `<div class="card"><h4>${res.title}</h4><p>${res.prompt}</p></div>`;
            }

        } catch (err) {
            console.error(err);
            alert("Model usage error. Please try selecting a different model in Settings.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }

    async callGemini(prompt, isJson = false, model = 'gemini-1.5-flash-latest') {
        const apiKey = this.getGeminiKey();
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Please update in Settings.");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, responseMimeType: isJson ? "application/json" : "text/plain" }
            })
        });
        if (!response.ok) throw new Error(`Model ${model} failed`);
        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        return isJson ? JSON.parse(text) : text;
    }

    async handleWritingSubmission() {
        const essayText = document.getElementById('writing-input').value.trim();
        if (!essayText || !this.currentTasks.writing) return;

        const feedbackPanel = document.getElementById('writing-feedback');
        feedbackPanel.classList.remove('hidden');
        feedbackPanel.innerHTML = '<div class="loading-spinner">Analyzing with AI...</div>';

        try {
            const evalPrompt = `Evaluate this IELTS essay for task: ${this.currentTasks.writing.prompt}. Essay: "${essayText}". Return JSON score and feedback.`;
            // Use MODEL_EVAL from settings
            const feedback = await this.callGemini(evalPrompt, true, this.userSettings.MODEL_EVAL);
            this.renderFeedback(feedback);
        } catch (err) {
            feedbackPanel.innerHTML = `<div class="error">Evaluation failed with chosen model.</div>`;
        }
    }

    renderFeedback(feedback) {
        document.getElementById('writing-feedback').innerHTML = `<h3>Band Score: ${feedback.overall_band || feedback.score}</h3><p>${feedback.summary_ja || feedback.feedback}</p>`;
    }

    async loadPracticeHistory() {
        if (!this.supabase) return;
        const { data } = await this.supabase.from('practice_sessions').select('*').order('created_at', { ascending: false }).limit(3);
        const list = document.getElementById('recommendation-list');
        if (list) list.innerHTML = data && data.length ? data.map(d => `<div>Past: ${d.score}</div>`).join('') : 'No history.';
    }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new IELTSCoach(); });
