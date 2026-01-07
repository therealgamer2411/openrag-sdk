const io = require('socket.io-client');
const SimplePeer = require('simple-peer');
const wrtc = require('@roamhq/wrtc');

class OpenRAG {
    /**
     * @param {Object} config
     * @param {string} config.apiKey - مفتاح الـ API الخاص بالمطور
     * @param {string} [config.serverUrl] - رابط السيرفر
     */
    constructor(config) {
        if (!config || !config.apiKey) {
            throw new Error("OpenRAG: API Key is required.");
        }

        this.apiKey = config.apiKey;
        // رابط السيرفر الرسمي الجديد
        this.serverUrl = config.serverUrl || 'https://openrag-grid.koyeb.app'; 
        
        this.socket = null;
        this.isConnected = false;
    }

    // 1. الاتصال بالسيرفر الرئيسي
    connect() {
        return new Promise((resolve, reject) => {
            // console.log('🌐 OpenRAG: Connecting to Grid...');

            this.socket = io(this.serverUrl, {
                auth: { token: this.apiKey },
                reconnection: true,
                rejectUnauthorized: false
            });

            this.socket.on('connect', () => {
                // console.log('✅ OpenRAG: Connected to Signaling Server.');
                this.isConnected = true;
                resolve(true);
            });

            this.socket.on('connect_error', (err) => {
                console.error('❌ Connection Error:', err.message);
                reject(err);
            });
        });
    }

    // 2. طلب البيانات
    async fetch(targetUrl) {
        if (!this.isConnected) {
            throw new Error("OpenRAG: Not connected. Call .connect() first.");
        }

        return new Promise((resolve, reject) => {
            // طلب عقدة (Peer)
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

            // Timeout بعد 45 ثانية
            setTimeout(() => {
                this.socket.off('PEER_FOUND', onPeerFound);
                this.socket.off('NO_PEERS_AVAILABLE', onNoPeers);
                reject(new Error("OpenRAG: Request Timeout (Network Busy)."));
            }, 45000);
        });
    }

    // 3. إنشاء نفق WebRTC (هنا التعديل الحاسم 🔥)
    _startP2P(targetId, targetUrl, resolve, reject) {
        const p = new SimplePeer({
            initiator: true,
            trickle: false,
            wrtc: wrtc,
            // 👇 هذه الإعدادات ضرورية لاختراق شبكات الموبايل
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' }
                ]
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
            // إرسال طلب الجلب
            p.send(JSON.stringify({ url: targetUrl }));
        });

        p.on('data', (data) => {
            const response = JSON.parse(data.toString());
            
            // تنظيف وإغلاق
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
            // تجاهل أخطاء إغلاق القناة المعتادة
            if (err.code === 'ERR_DATA_CHANNEL') return;
            reject(err);
        });
    }

    disconnect() {
        if (this.socket) this.socket.disconnect();
    }
}

module.exports = OpenRAG;
