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
        
        // Speech API
        this.recognition = null;
        this.isRecording = false;
        this.speakingHistory = [];
        this.timerInterval = null;
        
        this.init();
    }

    async init() {
        this.applySavedKeys();
        this.initSupabase();
        this.initScoreSelectors();
        this.initAPIFields();
        this.applyFontSize(this.userSettings.FONT_SIZE || 16);
        this.initSpeechAPI();
        this.bindEvents();
        this.applyLanguage();
        this.updateView();
        this.calculateOverall();
        
        if (this.getGeminiKey()) {
            await this.fetchModels();
            this.initModelSelectors();
        }
        
        lucide.createIcons();
    }

    loadSettings() {
        const saved = localStorage.getItem('iac_settings');
        const defaultSettings = { ...CONFIG.SYSTEM_TARGET, MODEL_GEN: 'gemini-1.5-flash-latest', MODEL_AUDIO: 'gemini-2.0-flash-exp', FONT_SIZE: 16 };
        return saved ? JSON.parse(saved) : defaultSettings;
    }

    saveSettings() { localStorage.setItem('iac_settings', JSON.stringify(this.userSettings)); }

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
        const { L, R, W, S } = this.userSettings;
        const avg = (L + R + W + S) / 4;
        const rounded = Math.round(avg * 4) / 4;
        document.getElementById('target-overall-val').textContent = rounded.toFixed(1);
    }

    initSupabase() {
        if (typeof supabase !== 'undefined' && this.getSupabaseURL()) {
            this.supabase = supabase.createClient(this.getSupabaseURL(), this.getSupabaseKey());
        }
    }

    initSpeechAPI() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.lang = 'en-US';
            this.recognition.interimResults = true;

            this.recognition.onstart = () => { document.getElementById('mic-status').classList.remove('hidden'); };
            this.recognition.onend = () => { 
                document.getElementById('mic-status').classList.add('hidden'); 
                this.isRecording = false;
            };
            this.recognition.onresult = (event) => {
                const transcript = Array.from(event.results).map(result => result[0].transcript).join('');
                document.getElementById('user-transcript').textContent = transcript;
                if (event.results[0].isFinal) {
                    this.handleUserVoiceInput(transcript);
                }
            };
        }
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => { e.preventDefault(); this.switchView(item.getAttribute('data-view')); });
        });
        document.getElementById('lang-ja')?.addEventListener('click', () => this.switchLanguage('ja'));
        document.getElementById('lang-en')?.addEventListener('click', () => this.switchLanguage('en'));
        ['writing', 'reading'].forEach(skill => {
            document.getElementById(`btn-gen-${skill}`)?.addEventListener('click', () => { this.startTimer(); this.generateProblem(skill); });
        });
        document.getElementById('btn-submit-writing')?.addEventListener('click', () => this.handleWritingSubmission());
        document.getElementById('btn-save-keys')?.addEventListener('click', () => this.handleSaveKeys());
        document.getElementById('writing-input')?.addEventListener('input', (e) => this.updateWordCount(e.target.value));

        // Speaking Events
        document.getElementById('btn-start-speaking')?.addEventListener('click', () => this.startSpeakingTest());
        document.getElementById('btn-mic')?.addEventListener('click', () => this.toggleMic());

        // Zoom
        document.getElementById('zoom-in')?.addEventListener('click', () => this.changeZoom(1));
        document.getElementById('zoom-out')?.addEventListener('click', () => this.changeZoom(-1));
    }

    startTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        let time = 60 * 60; // 60 minutes
        const timerEl = document.getElementById('cbt-timer');
        this.timerInterval = setInterval(() => {
            time--;
            const mins = Math.floor(time / 60);
            const secs = time % 60;
            timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            if (time <= 0) clearInterval(this.timerInterval);
        }, 1000);
    }

    updateWordCount(text) {
        const count = text.trim() ? text.trim().split(/\s+/).length : 0;
        document.getElementById('word-count-val').textContent = count;
    }

    changeZoom(delta) {
        let size = this.userSettings.FONT_SIZE || 16;
        size = Math.max(12, Math.min(30, size + delta));
        this.userSettings.FONT_SIZE = size;
        this.applyFontSize(size);
        this.saveSettings();
    }

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        document.getElementById(`${view}-view`)?.classList.remove('hidden');
    }

    async fetchModels() {
        const apiKey = this.getGeminiKey();
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await res.json();
            this.availableModels = { text: [], audio: [] };
            data.models.forEach(m => {
                const name = m.name.replace('models/', '');
                if (m.supportedGenerationMethods.includes('generateContent')) this.availableModels.text.push(name);
                if (name.includes('gemini-2.0') || name.includes('flash')) this.availableModels.audio.push(name);
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
    }

    async generateProblem(skill) {
        const btn = document.getElementById(`btn-gen-${skill}`);
        if (!btn) return;
        const originalText = btn.innerHTML;
        try {
            btn.disabled = true; btn.innerHTML = "Generating...";
            const target = this.userSettings[skill === 'reading' ? 'R' : (skill === 'writing' ? 'W' : 'S')];
            
            // Skill-Specific Topic Pools (Aligned with Official IELTS Trends)
            const topicPools = {
                reading: [
                    "The psychology of human memory and cognition", "Technological advancements in vertical farming", 
                    "Ancient maritime trade routes in Southeast Asia", "The impact of light pollution on nocturnal animals",
                    "The evolution of commercial aviation safety", "Advancements in deep-sea volcanic exploration",
                    "Biomimicry: Nature's influence on modern architecture", "The socio-economic history of the Silk Road",
                    "Climate change impact on glacial migration", "The linguistic evolution of lost languages"
                ],
                writing: [
                    "Government investment: Space exploration vs. Domestic poverty", "Remote work: Benefits and drawbacks for social cohesion",
                    "The role of traditional art in the digital age", "Compulsory community service for university students",
                    "Over-reliance on technology in early childhood education", "The ethical implications of genetic modification in food",
                    "Urban vs. Rural living: The impact of migration on city infrastructure", "Should international travel be limited to protect the environment?"
                ],
                speaking: [
                    "Part 1: Memories of childhood holidays and family trips", "Part 2: Describe a major environmental change you have witnessed",
                    "Part 3: The influence of social media celebrities on consumer behavior", "Part 1: Traditional festivals and the importance of heritage",
                    "Part 2: Describe a historical monument you visited and admire", "Part 3: The future of artificial intelligence in daily household tasks"
                ]
            };
            
            const pool = topicPools[skill] || topicPools.writing;
            const randomTopic = pool[Math.floor(Math.random() * pool.length)];

            // Refined CBT Output Format Prompt with Context-Specific Topic
            const prompt = `Act as an expert IELTS Examiner. 
            CONTEXT: Providing highly realistic practice for the ${skill} section.
            TOPIC AREA: ${randomTopic}. 
            TASK: Generate an authentic IELTS ${skill} Task (Band ${target}). 
            Instruction: Ensure the vocabulary and style match the actual IELTS ${skill} requirements perfectly.
            Structure with multiple paragraphs and clear headings.
            FOR READING: Passage and Questions must be separate.
            Return JSON Format: {"title":"(Title)","passage":"(Academic/Relevant Passage)","questions":"(Specific Questions)","prompt":"(Combined for Writing/Speaking)"}`;
            
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
        } catch (err) { alert("Generation failed. Check settings."); console.error(err); }
        finally { btn.disabled = false; btn.innerHTML = originalText; lucide.createIcons(); }
    }

    async callGemini(prompt, isJson = false, model = 'gemini-1.5-flash-latest') {
        const apiKey = this.getGeminiKey();
        if (!apiKey) throw new Error("API Key missing");
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                    temperature: 0.85, 
                    topP: 0.95,
                    responseMimeType: isJson ? "application/json" : "text/plain" 
                }
            })
        });
        if (!res.ok) throw new Error("API Call Failed");
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        return isJson ? JSON.parse(text) : text;
    }

    // SPEAKING TEST ENGINE
    async startSpeakingTest() {
        this.speakingHistory = [];
        document.getElementById('btn-start-speaking').classList.add('hidden');
        document.getElementById('btn-mic').disabled = false;
        const intro = "Good day. In this test, I am your examiner. Let's start Part 1. Can you tell me your full name and what you currently do?";
        this.examinerSpeak(intro);
        this.speakingHistory.push({ role: 'model', parts: [{ text: intro }] });
    }

    toggleMic() {
        if (this.isRecording) {
            this.recognition.stop();
        } else {
            this.recognition.start();
            this.isRecording = true;
        }
    }

    async handleUserVoiceInput(transcript) {
        if (!transcript) return;
        this.speakingHistory.push({ role: 'user', parts: [{ text: transcript }] });
        const prompt = `You are an IELTS Examiner. Based on the history, continue the Speaking test (Part 1, 2 or 3). Be natural. Keep questions concise. Current target: Band ${this.userSettings.S}. History: ${JSON.stringify(this.speakingHistory)}`;
        
        try {
            const aiRes = await this.callGemini(prompt, false, this.userSettings.MODEL_AUDIO);
            this.speakingHistory.push({ role: 'model', parts: [{ text: aiRes }] });
            this.examinerSpeak(aiRes);
        } catch (err) { alert("Speaking connection failed."); }
    }

    examinerSpeak(text) {
        document.getElementById('examiner-text').textContent = text;
        const msg = new SpeechSynthesisUtterance();
        msg.text = text;
        msg.lang = 'en-GB';
        msg.onstart = () => document.getElementById('examiner-status').classList.remove('hidden');
        msg.onend = () => document.getElementById('examiner-status').classList.add('hidden');
        window.speechSynthesis.speak(msg);
    }

    async handleWritingSubmission() { 
        alert("Exam finished. Evaluation will appear."); 
        const essay = document.getElementById('writing-input').value;
        const prompt = `IELTS Examiner. Evaluate Band ${this.userSettings.W} essay: "${essay}". JSON feedback.`;
        const res = await this.callGemini(prompt, true);
        this.renderFeedback(res);
    }

    renderFeedback(feedback) {
        const panel = document.getElementById(this.currentView === 'writing' ? 'writing-feedback' : 'speaking-feedback');
        panel.classList.remove('hidden');
        panel.innerHTML = `<h3>Band: ${feedback.overall_band || feedback.score}</h3><p>${feedback.summary_ja || "Review completed."}</p>`;
    }

    handleSaveKeys() { 
        const keys = { gemini: document.getElementById('input-gemini-key').value };
        localStorage.setItem('iac_keys', JSON.stringify(keys)); window.location.reload(); 
    }
    switchLanguage() { window.location.reload(); }
    applyLanguage() { lucide.createIcons(); }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new IELTSCoach(); });
