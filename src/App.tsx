import { StyleSheet, View, TextInput, StatusBar, Text, FlatList, TouchableOpacity, BackHandler, Pressable } from 'react-native';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { File, Directory, Paths } from 'expo-file-system';
import { ArrowLeft } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

function titleToFilename(title: string): string {
  return title.trim().replace(/\s+/g, '_') + '.md';
}

function filenameToTitle(filename: string): string {
  return filename.replace(/\.md$/, '').replace(/_/g, ' ');
}

function todayTitle(): string {
  const date = new Date();
  const months = [
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function getPreview(filename: string): string {
  try {
    const file = new File(getJournalsDir(), filename);
    if (!file.exists) return '';
    return file.textSync().replace(/^Mood: .+\n\n?/, '').replace(/^# .+\n\n?/, '');
  } catch {
    return '';
  }
}

const MOODS = [
  { key: 'awful', label: 'Awful', color: '#CC3333' },
  { key: 'bad', label: 'Bad', color: '#DD5533' },
  { key: 'sad', label: 'Sad', color: '#5577AA' },
  { key: 'meh', label: 'Meh', color: '#777777' },
  { key: 'okay', label: 'Okay', color: '#BB9933' },
  { key: 'good', label: 'Good', color: '#558844' },
  { key: 'happy', label: 'Happy', color: '#44AA44' },
] as const;

type Mood = typeof MOODS[number]['key'] | null;

function parseContent(content: string): { mood: Mood; title: string; body: string } {
  let mood: Mood = null;
  let rest = content;
  const moodMatch = content.match(/^Mood: (.+)\n\n/);
  if (moodMatch) {
    mood = moodMatch[1] as Mood;
    rest = content.slice(moodMatch[0].length);
  }
  const match = rest.match(/^# (.+)\n\n([\s\S]*)$/);
  if (match) return { mood, title: match[1], body: match[2].trim() };
  return { mood, title: '', body: rest.trim() };
}

function getJournalsDir(): Directory {
  const dir = new Directory(Paths.document, 'butterJournals');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

type Screen = 'list' | 'editor';

export default function App() {
  const [screen, setScreen] = useState<Screen>('editor');
  const [editingJournal, setEditingJournal] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const navigateToList = useCallback(() => {
    setListKey(k => k + 1);
    setScreen('list');
  }, []);

  const navigateToEditor = useCallback((filename: string | null) => {
    setEditingJournal(filename);
    setScreen('editor');
  }, []);

  useEffect(() => {
    const onBackPress = () => {
      if (screen === 'editor') {
        navigateToList();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [screen, navigateToList]);

  if (screen === 'editor') {
    return (
      <EditorScreen
        key={editingJournal ?? '__new__'}
        journalFilename={editingJournal}
        onBack={navigateToList}
      />
    );
  }

  return <ListScreen key={listKey} onOpen={navigateToEditor} />;
}

interface JournalEntry {
  filename: string;
  title: string;
  preview: string;
  mood: Mood;
}

function ListScreen({ onOpen }: { onOpen: (filename: string | null) => void }) {
  const [journals, setJournals] = useState<JournalEntry[]>([]);

  useEffect(() => {
    try {
      const dir = getJournalsDir();
      const entries = dir.list();
      const files = entries
        .filter((e): e is File => e instanceof File && e.name.endsWith('.md'))
        .sort((a, b) => {
          try { return (b.info().modificationTime ?? 0) - (a.info().modificationTime ?? 0); }
          catch { return 0; }
        })
        .map(f => {
          try {
            const file = new File(getJournalsDir(), f.name);
            const content = file.exists ? file.textSync() : '';
            const { mood, title, body } = parseContent(content);
            return {
              filename: f.name,
              title: title || filenameToTitle(f.name),
              preview: body,
              mood,
            };
          } catch {
            return { filename: f.name, title: filenameToTitle(f.name), preview: '', mood: null };
          }
        });
      setJournals(files);
    } catch {
      setJournals([]);
    }
  }, []);

  return (
    <View style={styles.shell}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <Text style={styles.listHeading}>Journals</Text>
      <FlatList
        data={journals}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={1} style={styles.journalItem} onPress={() => onOpen(item.filename)}>
            <View style={styles.journalHeader}>
              <Text style={styles.journalTitle}>{item.title}</Text>
              {item.mood ? (
                <View style={[styles.moodDot, { backgroundColor: MOODS.find(m => m.key === item.mood)?.color }]} />
              ) : null}
            </View>
            {item.preview ? (
              <View style={styles.previewWrap}>
                <Text style={styles.previewText}>{item.preview}</Text>
                <LinearGradient
                  colors={['transparent', '#000000']}
                  style={styles.previewFade}
                  pointerEvents="none"
                />
              </View>
            ) : null}
          </TouchableOpacity>
        )}
        keyExtractor={item => item.filename}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No journals yet</Text>
        }
      />
    </View>
  );
}

function EditorScreen({ journalFilename, onBack }: { journalFilename: string | null; onBack: () => void }) {
  const [mood, setMood] = useState<Mood>(null);
  const [title, setTitle] = useState(() => {
    if (journalFilename) return filenameToTitle(journalFilename);
    return todayTitle();
  });
  const [body, setBody] = useState('');
  const bodyRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!journalFilename) return;
    try {
      const file = new File(getJournalsDir(), journalFilename);
      if (file.exists) {
        const { mood: m, title: t, body: b } = parseContent(file.textSync());
        setMood(m);
        setTitle(t);
        setBody(b);
      }
    } catch { }
  }, [journalFilename]);

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback((m: Mood, t: string, b: string) => {
    if (!t.trim()) return;
    const dir = getJournalsDir();
    const moodLine = m ? `Mood: ${m}\n\n` : '';
    new File(dir, titleToFilename(t)).write(`${moodLine}# ${t}\n\n${b}`);
  }, []);

  const handleTitle = (text: string) => {
    setTitle(text);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => save(mood, text, body), 800);
  };

  const handleBody = (text: string) => {
    setBody(text);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => save(mood, title, text), 800);
  };

  const handleMood = (key: Mood) => {
    const next = key === mood ? null : key;
    setMood(next);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => save(next, title, body), 800);
  };

  return (
    <View style={styles.shell}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.editor}>
        <View style={styles.titleRow}>
          <TextInput
            style={styles.title}
            value={title}
            onChangeText={handleTitle}
            onSubmitEditing={() => bodyRef.current?.focus()}
            returnKeyType="next"
            placeholderTextColor="#2A2824"
            autoFocus={true}
          />
          <TouchableOpacity activeOpacity={1} onPress={onBack} style={styles.backButton}>
            <ArrowLeft size={20} color="#EAE6DF" />
          </TouchableOpacity>
        </View>
        <View style={styles.moodContainer}>
          {MOODS.map((m, i) => (
            <Pressable
              key={m.key}
              style={[
                styles.moodSegment,
                { backgroundColor: m.color, opacity: mood === m.key ? 1 : 0.35 },
              ]}
              onPress={() => handleMood(m.key)}
            >
              <Text style={styles.moodLabel}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          ref={bodyRef}
          style={styles.input}
          multiline={true}
          placeholder="Write here..."
          placeholderTextColor="#2A2824"
          value={body}
          onChangeText={handleBody}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#000000',
  },
  listHeading: {
    fontSize: 28,
    fontWeight: '700',
    color: '#EAE6DF',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  journalItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2824',
  },
  journalTitle: {
    fontSize: 16,
    color: '#EAE6DF',
  },
  journalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moodDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  previewWrap: {
    maxHeight: 48,
    overflow: 'hidden',
    marginTop: 2,
  },
  previewText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 16,
  },
  previewFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginTop: 40,
  },
  editor: {
    flex: 1,
    padding: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2824',
    marginBottom: 4,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#EAE6DF',
    paddingVertical: 4,
  },
  backButton: {
    padding: 4,
  },
  moodContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#1A1814',
    marginVertical: 8,
  },
  moodSegment: {
    flex: 1,
    paddingVertical: 5,
    alignItems: 'center',
  },
  moodLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EAE6DF',
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: '#EAE6DF',
    lineHeight: 22,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
});
