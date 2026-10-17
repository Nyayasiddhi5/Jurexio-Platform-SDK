import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  NyayamitraClient,
  OfflineDraftQueue,
  NYAYAMITRA_LANGUAGE_LIST,
  detectLanguage,
  isRTL,
  t,
  type NyayamitraLanguage,
  type MitraChatMessage,
} from '@nyayavigya/nyayamitra-sdk';
import { NyvClientRN } from '@nyayavigya/client-sdk-react-native';

const NYV_BASE_URL = (Constants.expoConfig?.extra?.NYV_BASE_URL as string) ?? 'https://api.nyayavigya.com';
const SESSION_KEY  = 'nymd.sessionId';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [lang, setLang] = useState<NyayamitraLanguage>('hi');
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<'chat' | 'classify' | 'brief' | 'patra'>('chat');
  const [sessionId, setSessionId] = useState<string>('sess_local_1');

  // Pick up the API key persisted by the RN wrapper's secure storage.
  useEffect(() => {
    (async () => {
      const rn = await NyvClientRN.create({ baseUrl: NYV_BASE_URL });
      const k = rn.getApiKey();
      if (k) setApiKey(k);
      const sid = await AsyncStorage.getItem(SESSION_KEY);
      if (sid) setSessionId(sid);
      else {
        const fresh = `sess_${Date.now().toString(36)}`;
        await AsyncStorage.setItem(SESSION_KEY, fresh);
        setSessionId(fresh);
      }
    })();
    const unsub = NetInfo.addEventListener(s => setOnline(!!s.isConnected));
    return () => unsub();
  }, []);

  const nym = useMemo(() => apiKey ? new NyayamitraClient({ apiKey, baseUrl: NYV_BASE_URL, defaultLanguage: lang }) : null, [apiKey, lang]);
  const queue = useMemo(() => new OfflineDraftQueue({ store: AsyncStorage }), []);

  async function saveKey() {
    if (!keyInput.startsWith('nyv_live_sk_')) {
      return Alert.alert('Invalid key', 'API keys start with `nyv_live_sk_`.');
    }
    const rn = await NyvClientRN.create({ baseUrl: NYV_BASE_URL });
    await rn.setApiKey(keyInput.trim());
    setApiKey(keyInput.trim());
    setKeyInput('');
  }

  if (!apiKey) {
    return (
      <ScrollView contentContainerStyle={styles.root}>
        <StatusBar style="auto" />
        <Text style={styles.h1}>Nyayamitra (sample)</Text>
        <Text style={styles.muted}>{t('disclaimerLegalNotLawyer', lang)}</Text>
        <TextInput
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder="nyv_live_sk_..."
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
        <Pressable onPress={saveKey} style={styles.btn}>
          <Text style={styles.btnText}>Save API key</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Nyayamitra</Text>
        <Text style={[styles.statusPill, { backgroundColor: online ? '#0a8' : '#a44' }]}>
          {online ? t('syncing', lang) : t('offline', lang)}
        </Text>
      </View>
      <LanguagePicker lang={lang} onChange={setLang} />
      <View style={styles.tabs}>
        {(['chat', 'classify', 'brief', 'patra'] as const).map(x => (
          <Pressable key={x} onPress={() => setTab(x)} style={[styles.tab, tab === x && styles.tabActive]}>
            <Text style={tab === x ? styles.tabActiveText : styles.tabText}>
              {x === 'patra' ? 'PATRA' : x.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'chat'     && nym && <ChatView    nym={nym} lang={lang} sessionId={sessionId} online={online} queue={queue} />}
      {tab === 'classify' && nym && <ClassifyView nym={nym} lang={lang} online={online} queue={queue} />}
      {tab === 'brief'    && nym && <BriefView    nym={nym} lang={lang} online={online} queue={queue} />}
      {tab === 'patra'    && nym && <PatraMitraView nym={nym} lang={lang} online={online} />}
      <Text style={[styles.muted, { marginTop: 24 }]}>{t('disclaimerLegalNotLawyer', lang)}</Text>
    </ScrollView>
  );
}

function LanguagePicker({ lang, onChange }: { lang: NyayamitraLanguage; onChange: (l: NyayamitraLanguage) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
      {NYAYAMITRA_LANGUAGE_LIST.map(l => (
        <Pressable key={l.code} onPress={() => onChange(l.code)} style={[styles.langChip, lang === l.code && styles.langChipActive]}>
          <Text style={lang === l.code ? styles.langChipActiveText : styles.langChipText}>{l.nativeName}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ChatView({ nym, lang, sessionId, online, queue }: any) {
  const [history, setHistory] = useState<MitraChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    const message = input.trim();
    if (!message) return;
    setHistory(h => [...h, { role: 'user', content: message }]);
    setInput('');
    const detected = detectLanguage(message);
    const useLang: NyayamitraLanguage = detected === 'en' ? lang : detected;
    if (!online) {
      await queue.enqueue({ kind: 'chat', payload: { message, language: useLang, sessionId, history } }, { language: useLang });
      setHistory(h => [...h, { role: 'assistant', content: t('savedOffline', useLang) }]);
      return;
    }
    setBusy(true);
    try {
      const r = await nym.chat({ message, language: useLang, sessionId, history });
      setHistory(h => [...h, { role: 'assistant', content: r.content }]);
    } catch (e: any) {
      setHistory(h => [...h, { role: 'assistant', content: `${t('error', useLang)}: ${e?.message ?? e}` }]);
    } finally { setBusy(false); }
  }
  return (
    <View>
      <View style={{ minHeight: 220 }}>
        {history.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi, isRTL(lang) && { alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end' }]}>
            <Text style={{ writingDirection: isRTL(lang) ? 'rtl' : 'ltr' }}>{m.content}</Text>
          </View>
        ))}
      </View>
      <TextInput value={input} onChangeText={setInput} placeholder={t('voiceTapToSpeak', lang)} multiline style={styles.input} />
      <Pressable onPress={send} disabled={busy} style={styles.btn}>
        <Text style={styles.btnText}>{busy ? t('loading', lang) : t('send', lang)}</Text>
      </Pressable>
    </View>
  );
}

function ClassifyView({ nym, lang, online, queue }: any) {
  const [doc, setDoc] = useState('');
  const [out, setOut] = useState<string>('');
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!doc.trim()) return;
    if (!online) {
      await queue.enqueue({ kind: 'classify', payload: { documentText: doc, language: lang } }, { language: lang });
      setOut(t('savedOffline', lang));
      return;
    }
    setBusy(true);
    try {
      const r = await nym.classifyClauses({ documentText: doc, language: lang });
      setOut(JSON.stringify(r, null, 2));
    } catch (e: any) { setOut(`${t('error', lang)}: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }
  return (
    <View>
      <Text style={styles.h2}>Clause classifier</Text>
      <TextInput value={doc} onChangeText={setDoc} multiline style={[styles.input, { minHeight: 100 }]} placeholder="Paste document text…" />
      <Pressable onPress={run} disabled={busy} style={styles.btn}>
        <Text style={styles.btnText}>{busy ? t('loading', lang) : t('send', lang)}</Text>
      </Pressable>
      {out ? <Text style={styles.box}>{out}</Text> : null}
    </View>
  );
}

function PatraMitraView({ nym, lang, online }: any) {
  const [docText, setDocText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [fields, setFields] = useState<string>('');
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  async function openDoc() {
    if (!docText.trim()) return;
    if (!online) return Alert.alert('Offline', 'Patra Mitra needs network');
    setBusy(true);
    try {
      const r = await nym.openPatraMitra({
        content: docText,
        fileName: 'mitra-note.txt',
        mimeType: 'text/plain',
        jurisdiction: 'IN',
      });
      setSessionId(String(r.sessionId || ''));
      setSummary(String(r.summary || ''));
      const fl = Array.isArray(r.fields)
        ? r.fields.map((f: any) => `${f.label}: ${f.value}`).join('\n')
        : '';
      setFields(fl);
      setAnswer('');
    } catch (e: any) {
      Alert.alert(t('error', lang), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (!sessionId || !q.trim()) return;
    setBusy(true);
    try {
      const r = await nym.askPatraMitra(sessionId, q.trim(), 'IN');
      setAnswer(String(r.answer || ''));
    } catch (e: any) {
      Alert.alert(t('error', lang), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={styles.h2}>Patra Mitra</Text>
      <Text style={styles.muted}>Parse · Understand · Ask (document companion)</Text>
      <TextInput
        value={docText}
        onChangeText={setDocText}
        multiline
        style={[styles.input, { minHeight: 100 }]}
        placeholder="Paste document text (or wire DocumentPicker for PDF/images)…"
      />
      <Pressable onPress={openDoc} disabled={busy} style={styles.btn}>
        <Text style={styles.btnText}>{busy ? t('loading', lang) : 'Open document'}</Text>
      </Pressable>
      {summary ? <Text style={styles.box}>{summary}</Text> : null}
      {fields ? <Text style={[styles.box, { marginTop: 8 }]}>{fields}</Text> : null}
      {sessionId ? (
        <>
          <TextInput value={q} onChangeText={setQ} style={styles.input} placeholder="Ask about this document…" />
          <Pressable onPress={ask} disabled={busy} style={styles.btn}>
            <Text style={styles.btnText}>{busy ? t('loading', lang) : 'Ask'}</Text>
          </Pressable>
          {answer ? <Text style={styles.box}>{answer}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function BriefView({ nym, lang, online, queue }: any) {
  const [narr, setNarr] = useState('');
  const [out, setOut] = useState<string>('');
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!narr.trim()) return;
    if (!online) {
      await queue.enqueue({ kind: 'case-brief', payload: { narrative: narr, language: lang } }, { language: lang });
      setOut(t('savedOffline', lang));
      return;
    }
    setBusy(true);
    try {
      const r = await nym.generateCaseBrief({ narrative: narr, language: lang });
      setOut(JSON.stringify(r, null, 2));
    } catch (e: any) { setOut(`${t('error', lang)}: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }
  return (
    <View>
      <Text style={styles.h2}>Case brief</Text>
      <TextInput value={narr} onChangeText={setNarr} multiline style={[styles.input, { minHeight: 100 }]} placeholder="अपनी कहानी बताइए…" />
      <Pressable onPress={run} disabled={busy} style={styles.btn}>
        <Text style={styles.btnText}>{busy ? t('loading', lang) : t('send', lang)}</Text>
      </Pressable>
      {out ? <Text style={styles.box}>{out}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  h1: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '600', marginVertical: 8 },
  muted: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, marginBottom: 12, minHeight: 40 },
  btn: { backgroundColor: '#0a58ff', padding: 12, borderRadius: 6, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
  box: { marginTop: 12, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6, fontFamily: 'Menlo' },
  tabs: { flexDirection: 'row', marginBottom: 16, borderBottomWidth: 1, borderColor: '#eee' },
  tab: { flex: 1, padding: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderColor: '#0a58ff' },
  tabText: { color: '#888' },
  tabActiveText: { color: '#0a58ff', fontWeight: '600' },
  langChip: { paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, borderRadius: 16, borderWidth: 1, borderColor: '#ddd' },
  langChipActive: { backgroundColor: '#0a58ff', borderColor: '#0a58ff' },
  langChipText: { color: '#444' },
  langChipActiveText: { color: '#fff', fontWeight: '600' },
  bubble: { padding: 10, borderRadius: 8, marginVertical: 4, maxWidth: '85%' },
  bubbleUser: { backgroundColor: '#dbeafe', alignSelf: 'flex-end' },
  bubbleAi: { backgroundColor: '#f1f5f9', alignSelf: 'flex-start' },
  statusPill: { color: '#fff', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, fontSize: 12 },
});
