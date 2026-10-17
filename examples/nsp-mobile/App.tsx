import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Text, TextInput, View, Pressable, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import type {
  JrxDocumentAnalysis,
  JrxPatternResponse,
  JrxPrecedentSearchResult,
  JrxVoiceSynthesisResponse,
} from '@nyayavigya/client-sdk';
import { JrxClientRN, requestStandardSdkPermissions } from '@nyayavigya/client-sdk-react-native';

const JRX_BASE_URL = (Constants.expoConfig?.extra?.JRX_BASE_URL as string) ?? 'https://api.nyayavigya.com';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  const [client, setClient] = useState<JrxClientRN | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [haveKey, setHaveKey] = useState(false);
  const [tab, setTab] = useState<'chat' | 'doc' | 'voice' | 'intel'>('chat');

  useEffect(() => {
    (async () => {
      const c = await JrxClientRN.create({ baseUrl: JRX_BASE_URL });
      setClient(c);
      setHaveKey(!!c.getApiKey());
    })();
  }, []);

  async function saveKey() {
    if (!client) return;
    if (!keyInput.startsWith('nyv_live_sk_')) {
      return Alert.alert('Invalid key', 'API keys start with `nyv_live_sk_`.');
    }
    await client.setApiKey(keyInput.trim());
    setHaveKey(true);
    setKeyInput('');
    const perms = await requestStandardSdkPermissions();
    if (!perms.camera.granted)     console.warn('Camera not granted:', perms.camera);
    if (!perms.microphone.granted) console.warn('Mic not granted:',    perms.microphone);
  }

  async function signOut() { await client?.signOut(); setHaveKey(false); }

  if (!client) return <Center><Text>Loading SDK…</Text></Center>;

  if (!haveKey) {
    return (
      <ScrollView contentContainerStyle={styles.root}>
        <StatusBar style="auto" />
        <Text style={styles.h1}>NSP Mobile (sample)</Text>
        <Text style={styles.muted}>Paste your Jurexio SDK key to begin.</Text>
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
          <Text style={styles.btnText}>Save key (secure storage)</Text>
        </Pressable>
        <Text style={[styles.muted, { marginTop: 16 }]}>
          The key is stored in {client.storage.backend} (secure: {String(client.storage.secure)}).
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.tabs}>
        {(['chat', 'doc', 'voice', 'intel'] as const).map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={tab === t ? styles.tabActiveText : styles.tabText}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'chat'  && <ChatTab  client={client} />}
      {tab === 'doc'   && <DocTab   client={client} />}
      {tab === 'voice' && <VoiceTab client={client} />}
      {tab === 'intel' && <IntelTab client={client} />}
      <Pressable onPress={signOut} style={[styles.btn, { backgroundColor: '#888', marginTop: 24 }]}>
        <Text style={styles.btnText}>Sign out (forget key)</Text>
      </Pressable>
    </ScrollView>
  );
}

function ChatTab({ client }: { client: JrxClientRN }) {
  const [q, setQ] = useState('What is BNS Section 103?');
  const [a, setA] = useState<string>('');
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try {
      const res: JrxPatternResponse = await client.client.ask(q);
      setA(String(res.result ?? JSON.stringify(res, null, 2)));
    } catch (e) {
      setA('Error: ' + errMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Text style={styles.h2}>Chat</Text>
      <TextInput value={q} onChangeText={setQ} multiline style={styles.input} />
      <Pressable onPress={ask} disabled={busy} style={styles.btn}>
        <Text style={styles.btnText}>{busy ? 'Asking…' : 'Ask'}</Text>
      </Pressable>
      {a ? <Text style={styles.box}>{a}</Text> : null}
    </View>
  );
}

interface ImagePickerAsset {
  uri: string;
  base64?: string;
}
interface ImagePickerResult {
  canceled: boolean;
  assets: ImagePickerAsset[];
}
interface ExpoImagePickerModule {
  launchImageLibraryAsync(options: {
    mediaTypes: unknown;
    base64?: boolean;
    quality?: number;
  }): Promise<ImagePickerResult>;
  MediaTypeOptions: { Images: unknown };
}

function DocTab({ client }: { client: JrxClientRN }) {
  const [out, setOut] = useState<string>('');
  async function pickAndAnalyze() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ip = require('expo-image-picker') as ExpoImagePickerModule;
      const r = await ip.launchImageLibraryAsync({
        mediaTypes: ip.MediaTypeOptions.Images,
        base64: true,
        quality: 0.7,
      });
      if (r.canceled) return;
      const a = r.assets[0];
      const apiKey = client.getApiKey();
      if (!apiKey) throw new Error('No API key set');
      const fd = new FormData();
      // RN FormData accepts { uri, name, type } as a file part. The DOM lib
      // typings don't model this, so we cast through `unknown`.
      fd.append('file', { uri: a.uri, name: 'capture.jpg', type: 'image/jpeg' } as unknown as Blob);
      const res = await fetch(`${JRX_BASE_URL}/api/nv/documents/ocr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });
      if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
      const json: JrxDocumentAnalysis = await res.json();
      setOut(JSON.stringify(json, null, 2));
    } catch (e) {
      setOut('Error: ' + errMessage(e));
    }
  }
  return (
    <View>
      <Text style={styles.h2}>Document OCR</Text>
      <Pressable onPress={pickAndAnalyze} style={styles.btn}>
        <Text style={styles.btnText}>Pick image and OCR</Text>
      </Pressable>
      {out ? <Text style={styles.box}>{out}</Text> : null}
    </View>
  );
}

function VoiceTab({ client }: { client: JrxClientRN }) {
  const [text, setText] = useState('यह एक नमूना उत्तर है।');
  const [out, setOut] = useState<string>('');
  async function synth() {
    try {
      const res: JrxVoiceSynthesisResponse = await client.client.voice.synthesize({
        text, language: 'hi', voice: 'sarvam-meera',
      });
      setOut(`format=${res.format} duration=${res.durationMs}ms chars=${res.characters} (audioBase64 length=${res.audioBase64.length})`);
    } catch (e) {
      setOut('Error: ' + errMessage(e));
    }
  }
  return (
    <View>
      <Text style={styles.h2}>Voice (Sarvam Hindi)</Text>
      <TextInput value={text} onChangeText={setText} multiline style={styles.input} />
      <Pressable onPress={synth} style={styles.btn}>
        <Text style={styles.btnText}>Synthesize</Text>
      </Pressable>
      {out ? <Text style={styles.box}>{out}</Text> : null}
    </View>
  );
}

function IntelTab({ client }: { client: JrxClientRN }) {
  const [q, setQ] = useState('right to privacy supreme court India');
  const [out, setOut] = useState<string>('');
  async function search() {
    try {
      const res: JrxPrecedentSearchResult = await client.client.intelligence.findPrecedents(q, 'IN', { maxResults: 5 });
      setOut(JSON.stringify(res, null, 2));
    } catch (e) {
      setOut('Error: ' + errMessage(e));
    }
  }
  return (
    <View>
      <Text style={styles.h2}>Precedent search</Text>
      <TextInput value={q} onChangeText={setQ} style={styles.input} />
      <Pressable onPress={search} style={styles.btn}>
        <Text style={styles.btnText}>Search</Text>
      </Pressable>
      {out ? <Text style={styles.box}>{out}</Text> : null}
    </View>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={[styles.root, { flex: 1, alignItems: 'center', justifyContent: 'center' }]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingTop: 60 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  h2: { fontSize: 18, fontWeight: '600', marginVertical: 8 },
  muted: { color: '#666', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, marginBottom: 12, minHeight: 40 },
  btn: { backgroundColor: '#0a58ff', padding: 12, borderRadius: 6, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
  box: { marginTop: 12, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6, fontFamily: 'Menlo' },
  tabs: { flexDirection: 'row', marginBottom: 16, borderBottomWidth: 1, borderColor: '#eee' },
  tab: { flex: 1, padding: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderColor: '#0a58ff' },
  tabText: { color: '#888' },
  tabActiveText: { color: '#0a58ff', fontWeight: '600' },
});
