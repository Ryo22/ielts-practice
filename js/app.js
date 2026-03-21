import CONFIG from './config.js';
import TRANSLATIONS from './i18n.js';

class IELTSCoach {
    constructor() {
        this.currentLang = localStorage.getItem('iac_lang') || 'ja';
        this.currentView = 'dashboard';
        this.userSettings = this.loadSettings();
        this.supabase = null;
        this.currentTasks = { writing: null, reading: null, speaking: null };
        
        this.init();
    }

    async init() {
        this.initSupabase();
        this.initScoreSelectors();
        this.bindEvents();
        this.applyLanguage();
        this.updateView();
        this.calculateOverall();
        lucide.createIcons();
        
        await this.loadPracticeHistory();
    }

    loadSettings() {
        const saved = localStorage.getItem('iac_settings');
        return saved ? JSON.parse(saved) : CONFIG.SYSTEM_TARGET;
    }

    saveSettings() {
        localStorage.setItem('iac_settings', JSON.stringify(this.userSettings));
        this.calculateOverall();
    }

    initSupabase() {
        if (typeof supabase !== 'undefined') {
            this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        }
    }

    initScoreSelectors() {
        const skills = ['l', 'r', 'w', 's'];
        skills.forEach(skill => {
            const select = document.getElementById(`target-${skill}`);
            if (!select) return;

            for (let i = 4.0; i <= 9.0; i += 0.5) {
                const opt = document.createElement('option');
                opt.value = i.toFixed(1);
                opt.textContent = i.toFixed(1);
                if (parseFloat(this.userSettings[skill.toUpperCase() || skill]) === i) opt.selected = true;
                select.appendChild(opt);
            }

            select.addEventListener('change', (e) => {
                const val = parseFloat(e.target.value);
                this.userSettings[skill.toUpperCase()] = val;
                this.saveSettings();
            });
        });
    }

    calculateOverall() {
        const { L, R, W, S } = this.userSettings;
        const avg = (L + R + W + S) / 4;
        
        // IELTS rounding: Round to nearest 0.25, then adjust if needed
        // simplified: 0.125 increments to 0.25, etc.
        const rounded = Math.round(avg * 4) / 4;
        
        // Final score should be 0.5 increments
        // .0, .25 -> .0 or .5, .75 -> .5 or 1.0
        // More precise: 7.125 -> 7.0, 7.25 -> 7.5, 7.75 -> 8.0
        let final = rounded;
        const fraction = rounded % 1;
        if (fraction === 0.25) final += 0.25;
        if (fraction === 0.75) final += 0.25;

        document.getElementById('target-overall-val').textContent = final.toFixed(1);
        const progressFill = document.getElementById('overall-progress');
        if (progressFill) progressFill.style.width = `${(final / 9) * 100}%`;
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView(item.getAttribute('data-view'));
            });
        });

        // Language
        document.getElementById('lang-ja').addEventListener('click', () => this.switchLanguage('ja'));
        document.getElementById('lang-en').addEventListener('click', () => this.switchLanguage('en'));

        // Problem Generation
        document.getElementById('btn-gen-writing')?.addEventListener('click', () => this.generateProblem('writing'));
        document.getElementById('btn-gen-reading')?.addEventListener('click', () => this.generateProblem('reading'));
        document.getElementById('btn-gen-speaking')?.addEventListener('click', () => this.generateProblem('speaking'));

        // Submissions
        document.getElementById('btn-submit-writing')?.addEventListener('click', () => this.handleWritingSubmission());
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
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (trans[key]) el.placeholder = trans[key];
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

    /** AI Problem Generation */
    async generateProblem(skill) {
        const target = this.userSettings[skill === 'writing' ? 'W' : (skill === 'reading' ? 'R' : 'S')];
        const btn = document.getElementById(`btn-gen-${skill}`);
        const originalText = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>Generating...</span>`;
            lucide.createIcons();

            const prompt = `Generate a professional IELTS ${skill.toUpperCase()} Task 2 problem.
            Difficulty Level: Target Band ${target}.
            Format: Return a JSON object with:
            {
                "id": "unique_id",
                "title": "Title of the topic",
                "prompt": "The actual task description",
                "tips": "Brief hint for this level"
            }`;

            const res = await this.callGemini(prompt, true);
            this.currentTasks[skill] = res;

            if (skill === 'writing') {
                const container = document.getElementById('writing-task-container');
                container.classList.remove('hidden');
                document.getElementById('writing-prompt-title').textContent = res.title;
                document.getElementById('writing-prompt-body').textContent = res.prompt;
                document.getElementById('btn-submit-writing').disabled = false;
            } else if (skill === 'reading') {
                // More complex for reading, but for now just showing title
                const container = document.getElementById('reading-content');
                container.innerHTML = `<div class="card"><h4>${res.title}</h4><p>${res.prompt}</p></div>`;
            }

        } catch (err) {
            console.error(err);
            alert("Failed to generate problem. Check console.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
            lucide.createIcons();
        }
    }

    async callGemini(prompt, isJson = false, model = 'gemini-1.5-flash-latest') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        responseMimeType: isJson ? "application/json" : "text/plain"
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Gemini API Error: ${response.status} ${errorData.error?.message || ''}`);
            }

            const data = await response.json();
            if (!data.candidates || data.candidates.length === 0) throw new Error("No response from AI");
            
            const text = data.candidates[0].content.parts[0].text;
            return isJson ? JSON.parse(text) : text;
        } catch (err) {
            console.error("Gemini Fetch Error:", err);
            throw err;
        }
    }

    /** Writing Evaluation */
    async handleWritingSubmission() {
        const essayInput = document.getElementById('writing-input');
        const essayText = essayInput.value.trim();
        const task = this.currentTasks.writing;

        if (!essayText || !task) return;

        const btn = document.getElementById('btn-submit-writing');
        const originalContent = btn.innerHTML;
        const feedbackPanel = document.getElementById('writing-feedback');
        
        try {
            btn.disabled = true;
            btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span data-i18n="loading">添削中...</span>`;
            lucide.createIcons();

            feedbackPanel.classList.remove('hidden');
            feedbackPanel.innerHTML = '<div class="loading-spinner">AI Examiner is analyzing your essay...</div>';

            const evalPrompt = `
                IELTS Examiner Mode.
                Task: ${task.prompt}
                User Essay: "${essayText}"
                Target Band: ${this.userSettings.W}
                
                Evaluate based on: Task Response, Cohesion, Lexical Resource, Grammar.
                Return JSON:
                {
                    "overall_band": number,
                    "criteria": { "tr": {"band":n, "feedback":""}, "cc":{"band":n, "feedback":""}, "lr":{"band":n, "feedback":""}, "gra":{"band":n, "feedback":""} },
                    "improvements": ["str"],
                    "vocabulary_upgrades": [{"original":"", "suggested":"", "reason":""}],
                    "summary_ja": "日本語要約",
                    "summary_en": "English Summary"
                }
            `;

            const feedback = await this.callGemini(evalPrompt, true, 'gemini-1.5-pro-latest');
            this.renderFeedback(feedback);
            await this.saveToSupabase('writing', essayText, feedback);

        } catch (error) {
            console.error(error);
            feedbackPanel.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }

    renderFeedback(feedback) {
        const panel = document.getElementById('writing-feedback');
        const lang = this.currentLang;
        const summary = lang === 'ja' ? feedback.summary_ja : feedback.summary_en;

        let html = `
            <div class="feedback-header">
                <h3>Overall: Band ${feedback.overall_band}</h3>
                <p>${summary}</p>
            </div>
            <div class="crit-grid">
                ${Object.entries(feedback.criteria).map(([k, v]) => `
                    <div class="crit-box">
                        <strong>${k.toUpperCase()}: ${v.band}</strong>
                        <p>${v.feedback}</p>
                    </div>
                `).join('')}
            </div>
            <div class="upgrades">
                <h4>Vocabulary Boost</h4>
                <ul>
                    ${feedback.vocabulary_upgrades.map(u => `<li>${u.original} → ${u.suggested} (${u.reason})</li>`).join('')}
                </ul>
            </div>
        `;
        panel.innerHTML = html;
        panel.scrollIntoView({ behavior: 'smooth' });
    }

    async saveToSupabase(skill, input, feedback) {
        if (!this.supabase) return;
        await this.supabase.from('practice_sessions').insert([{
            skill_type: skill,
            user_input: input,
            ai_feedback: feedback,
            score: feedback.overall_band
        }]);
    }

    async loadPracticeHistory() {
        if (!this.supabase) return;
        const { data } = await this.supabase.from('practice_sessions').select('*').order('created_at', { ascending: false }).limit(5);
        if (data) this.renderRecommendations(data);
    }

    renderRecommendations(history) {
        const list = document.getElementById('recommendation-list');
        if (!list) return;
        list.innerHTML = history.length ? history.map(h => `<div class='rec-item'>Past Practice: ${h.skill_type} - Score: ${h.score}</div>`).join('') : '<p>No history yet. Let\'s start practicing!</p>';
    }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new IELTSCoach(); });
