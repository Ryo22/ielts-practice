import CONFIG from './config.js';
import TRANSLATIONS from './i18n.js';

class IELTSCoach {
    constructor() {
        this.currentLang = localStorage.getItem('iac_lang') || 'ja';
        this.currentView = 'dashboard';
        this.userSettings = CONFIG.SYSTEM_TARGET;
        this.supabase = null;
        
        this.init();
    }

    async init() {
        this.initSupabase();
        this.bindEvents();
        this.applyLanguage();
        this.updateView();
        lucide.createIcons();
        
        // Load initial data
        await this.loadPracticeHistory();
    }

    initSupabase() {
        if (typeof supabase === 'undefined') {
            console.error("Supabase SDK not loaded");
            return;
        }
        this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }

    bindEvents() {
        // View switching
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.getAttribute('data-view');
                this.switchView(view);
            });
        });

        // Language switching
        document.getElementById('lang-ja').addEventListener('click', () => this.switchLanguage('ja'));
        document.getElementById('lang-en').addEventListener('click', () => this.switchLanguage('en'));

        // Writing submission
        document.getElementById('btn-submit-writing').addEventListener('click', () => this.handleWritingSubmission());
    }

    switchLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('iac_lang', lang);
        this.applyLanguage();
        
        // Update button states
        document.getElementById('lang-ja').classList.toggle('active', lang === 'ja');
        document.getElementById('lang-en').classList.toggle('active', lang === 'en');
        
        // Update HTML lang attribute
        document.documentElement.lang = lang;
    }

    applyLanguage() {
        const trans = TRANSLATIONS[this.currentLang];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (trans[key]) el.textContent = trans[key];
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (trans[key]) el.placeholder = trans[key];
        });
    }

    switchView(view) {
        this.currentView = view;
        this.updateView();
        
        // Update nav UI
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-view') === view);
        });
    }

    updateView() {
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.add('hidden');
        });
        document.getElementById(`${this.currentView}-view`).classList.remove('hidden');
        
        // Update title
        const trans = TRANSLATIONS[this.currentLang];
        const viewTitle = document.getElementById('view-title');
        const viewKey = this.currentView + '_module';
        viewTitle.textContent = trans[viewKey] || trans[this.currentView] || this.currentView;
    }

    async loadPracticeHistory() {
        if (!this.supabase) return;
        
        try {
            const { data, error } = await this.supabase
                .from('practice_sessions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;
            if (data && data.length > 0) {
                this.renderDashboardStats(data[0]);
            }
        } catch (err) {
            console.warn("Could not load history:", err.message);
        }
    }

    renderDashboardStats(latestSession) {
        // Here we could update the dashboard with the latest score
        if (latestSession.score) {
            // Find score elements in dashboard and update
            console.log("Latest score from DB:", latestSession.score);
        }
    }

    async handleWritingSubmission() {
        const essayText = document.getElementById('writing-input').value;
        if (!essayText.trim()) return;

        const btn = document.getElementById('btn-submit-writing');
        const originalContent = btn.innerHTML;
        const feedbackPanel = document.getElementById('writing-feedback');
        
        try {
            btn.disabled = true;
            btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span data-i18n="loading">分析中...</span>`;
            lucide.createIcons();
            this.applyLanguage();

            feedbackPanel.classList.remove('hidden');
            feedbackPanel.querySelector('.feedback-body').innerHTML = '<div class="loading-spinner">Analyzing...</div>';

            const feedback = await this.getGeminiFeedback(essayText);
            this.renderFeedback(feedback);
            
            // SAVE TO SUPABASE
            await this.saveToSupabase('writing', essayText, feedback);

        } catch (error) {
            console.error("AI Error:", error);
            feedbackPanel.querySelector('.feedback-body').innerHTML = `<div class="error">Error: ${error.message}</div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }

    async saveToSupabase(skill, input, feedback) {
        if (!this.supabase) return;
        
        try {
            const { error } = await this.supabase
                .from('practice_sessions')
                .insert([{
                    skill_type: skill,
                    user_input: input,
                    ai_feedback: feedback,
                    score: feedback.overall_band
                }]);
            
            if (error) throw error;
        } catch (err) {
            console.error("Supabase Save Error:", err.message);
        }
    }

    async getGeminiFeedback(essay) {
        const prompt = this.buildWritingPrompt(essay);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) throw new Error("API request failed");
        const data = await response.json();
        return JSON.parse(data.candidates[0].content.parts[0].text);
    }

    buildWritingPrompt(essay) {
        const target = this.userSettings.WRITING;
        return `You are a professional IELTS Examiner.
        Target Writing Score: ${target}
        User Essay: "${essay}"
        
        Evaluation Guidelines:
        - If target >= 7.5: Be extremely strict about "naturalness", "logical flow", "less common lexical items", and collocations.
        - If target < 6.5: Focus on basic grammar mistakes and paragraph structure.
        
        Output MUST be in valid JSON format with the following structure:
        {
            "overall_band": number,
            "criteria": {
                "task_response": { "band": number, "feedback": "string", "improvements": ["string"] },
                "coherence_cohesion": { "band": number, "feedback": "string", "improvements": ["string"] },
                "lexical_resource": { "band": number, "feedback": "string", "upgrades": [{"original": "string", "suggested": "string", "reason": "string"}] },
                "grammatical_range": { "band": number, "feedback": "string", "corrections": [{"original": "string", "corrected": "string", "rule": "string"}] }
            },
            "model_answer_snippet": "string",
            "summary_feedback_ja": "日本語での要約フィードバック",
            "summary_feedback_en": "Summary feedback in English"
        }
        
        IMPORTANT: Use evidence-based feedback. Refer to band descriptors.`;
    }

    renderFeedback(feedback) {
        const panel = document.getElementById('writing-feedback');
        const body = panel.querySelector('.feedback-body');
        const scoreBadge = panel.querySelector('.score-badge');
        
        scoreBadge.textContent = feedback.overall_band;
        
        const lang = this.currentLang;
        const summary = lang === 'ja' ? feedback.summary_feedback_ja : feedback.summary_feedback_en;

        let html = `
            <div class="feedback-summary">
                <p><strong>${summary}</strong></p>
            </div>
            <div class="criteria-grid">
                ${Object.entries(feedback.criteria).map(([key, data]) => `
                    <div class="criteria-item">
                        <div class="criteria-header">
                            <span class="criteria-name">${key.replace('_', ' ').toUpperCase()}</span>
                            <span class="criteria-score">Band ${data.band}</span>
                        </div>
                        <p class="criteria-desc">${data.feedback}</p>
                    </div>
                `).join('')}
            </div>
            <div class="vocabulary-section">
                <h4>Recommended Vocabulary Upgrades</h4>
                <div class="upgrade-list">
                    ${feedback.criteria.lexical_resource.upgrades.map(u => `
                        <div class="upgrade-item">
                            <span class="word-original">${u.original}</span>
                            <i data-lucide="arrow-right"></i>
                            <span class="word-suggested">${u.suggested}</span>
                            <p class="word-reason">${u.reason}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        body.innerHTML = html;
        lucide.createIcons();
    }
}

// Initialize the app
window.addEventListener('DOMContentLoaded', () => {
    window.app = new IELTSCoach();
});
