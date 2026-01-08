const io = require('socket.io-client');
const SimplePeer = require('simple-peer');
const wrtc = require('@roamhq/wrtc');

class OpenRAG {
    /**
     * @param {Object} config
     * @param {string} config.apiKey - مفتاح الـ API
     * @param {string} [config.serverUrl] - رابط السيرفر
     */
    constructor(config) {
        if (!config || !config.apiKey) {
            throw new Error("OpenRAG: API Key is required.");
        }

        this.apiKey = config.apiKey;
        this.serverUrl = config.serverUrl || 'https://openrag-grid.koyeb.app'; 
        
        // 1. القائمة الافتراضية (Google STUN)
        // سيتم تحديثها تلقائياً عند الاتصال بالسيرفر
        this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        
        this.socket = null;
        this.isConnected = false;
    }

    // ==========================================
    // 1. الاتصال بالسيرفر
    // ==========================================
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(this.serverUrl, {
                auth: { token: this.apiKey },
                reconnection: true,
                rejectUnauthorized: false
            });

            this.socket.on('connect', () => {
                this.isConnected = true;
                resolve(true);
            });

            // 🔥 استلام إعدادات Cloudflare الديناميكية
            this.socket.on('ICE_CONFIG', (data) => {
                if(data && data.iceServers && data.iceServers.length > 0) {
                    this.iceServers = data.iceServers;
                }
            });

            this.socket.on('connect_error', (err) => {
                reject(new Error(`OpenRAG Connection Failed: ${err.message}`));
            });
        });
    }

    // ==========================================
    // 2. طلب البيانات (مع الحماية القانونية)
    // ==========================================
    async fetch(targetUrl) {
        if (!this.isConnected) {
            throw new Error("OpenRAG: Not connected. Call .connect() first.");
        }

        const urlLower = targetUrl.toLowerCase();

        // 🛡️ 1. الامتثال للقانون المصري (Pre-flight Check)
        // نمنع الطلب من هنا لتوفير الوقت وحماية الشبكة
        const forbiddenDomains = [
            '.gov.eg', '.mil.eg', 'cbe.org.eg', 'mod.gov.eg', 'porn', 'xxx', 'darkweb'
        ];
        
        if (forbiddenDomains.some(d => urlLower.includes(d))) {
            throw new Error(`OpenRAG Security: Request Blocked. Access to '${targetUrl}' is prohibited under Egyptian Cybercrime Law.`);
        }

        // 🛡️ 2. مكافحة الفيروسات (Malware Pre-Check)
        const dangerousExts = [
            '.exe', '.msi', '.bat', '.cmd', '.sh', '.php', '.pl', 
            '.jar', '.vbs', '.apk', '.dmg', '.iso', '.bin', '.dll'
        ];

        if (dangerousExts.some(ext => urlLower.endsWith(ext))) {
            throw new Error(`OpenRAG Security: Request Blocked. Executable files are strictly forbidden.`);
        }

        return new Promise((resolve, reject) => {
            this.socket.emit('REQUEST_PEER');

            const onPeerFound = ({ targetId }) => {
                this.socket.off('PEER_FOUND', onPeerFound);
                this._startP2P(targetId, targetUrl, resolve, reject);
            };

            const onNoPeers = () => {
                this.socket.off('PEER_FOUND', onPeerFound);
                reject(new Error("OpenRAG: No nodes available right now."));
            };

            this.socket.on('PEER_FOUND', onPeerFound);
            this.socket.once('NO_PEERS_AVAILABLE', onNoPeers);

            // Timeout 45s
            setTimeout(() => {
                this.socket.off('PEER_FOUND', onPeerFound);
                this.socket.off('NO_PEERS_AVAILABLE', onNoPeers);
                reject(new Error("OpenRAG: Request Timeout (Network Busy)."));
            }, 45000);
        });
    }

    // ==========================================
    // 3. نفق WebRTC (Trickle Enabled 🔥)
    // ==========================================
    _startP2P(targetId, targetUrl, resolve, reject) {
        const p = new SimplePeer({
            initiator: true,
            
            // 🔥 هام جداً: تفعيل التقطير ليتوافق مع الهاتف ويمنع التايم أوت
            trickle: true, 
            
            wrtc: wrtc,
            config: {
                iceServers: this.iceServers // استخدام السيرفرات الديناميكية
            }
        });

        p.on('signal', (data) => {
            this.socket.emit('SIGNAL_MESSAGE', { targetId, signal: data });
        });

        const onSignal = (data) => {
            if (data.senderId === targetId) p.signal(data.signal);
        };
        this.socket.on('SIGNAL_RECEIVED', onSignal);

        p.on('connect', () => {
            // إرسال الرابط المطلوب
            p.send(JSON.stringify({ url: targetUrl }));
        });

        p.on('data', (data) => {
            const response = JSON.parse(data.toString());
            
            this.socket.off('SIGNAL_RECEIVED', onSignal);
            p.destroy();

            if (response.status === 200) {
                resolve(response.body);
            } else {
                reject(new Error(response.error || "Fetch Failed"));
            }
        });

        p.on('error', (err) => {
            this.socket.off('SIGNAL_RECEIVED', onSignal);
            if (err.code === 'ERR_DATA_CHANNEL') return; 
            reject(err);
        });
        
        // Timeout للمصافحة
        setTimeout(() => {
            if(!p.connected) {
                 p.destroy();
                 this.socket.off('SIGNAL_RECEIVED', onSignal);
                 reject(new Error("OpenRAG: Connection Handshake Timeout."));
            }
        }, 40000);
    }

    disconnect() {
        if (this.socket) this.socket.disconnect();
    }
}

module.exports = OpenRAG;
