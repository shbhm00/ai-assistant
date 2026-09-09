/**
 * __DEV__-only floating debug AI assistant overlay.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ensureDevAIAssistantProvider,
  getActiveProviderName,
  getPreferredProvider,
} from './devAssistant';
import { isDev } from './isDev';

const DEFAULT_QUICK_PROMPTS = [
  'Is the device online? Summarize network info.',
  'Analyze recent network logs and list failures.',
  'Which API calls were slowest recently?',
];

export interface DevAIAssistantOverlayProps {
  quickPrompts?: string[];
  fabBottom?: number;
}

export function DevAIAssistantOverlay({
  quickPrompts = DEFAULT_QUICK_PROMPTS,
  fabBottom = 96,
}: DevAIAssistantOverlayProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState('');
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      role: string;
      content: string;
      toolPayload?: unknown;
      isError?: boolean;
    }>
  >([]);
  const [provider, setProvider] = useState<string>(() => getPreferredProvider());
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<{ cancel?: (reason?: string) => void } | null>(null);
  const sessionRef = useRef<{
    streamMessage: (
      content: string,
      callbacks: Record<string, unknown>
    ) => { promise: Promise<unknown>; cancel?: (reason?: string) => void };
    clear?: () => void;
  } | null>(null);
  const scrollRef = useRef<{ scrollToEnd?: (opts: { animated: boolean }) => void } | null>(null);

  useEffect(() => {
    return () => {
      handleRef.current?.cancel?.('overlay unmounted');
    };
  }, []);

  const appendMessage = useCallback(
    (role: string, content: string, meta: Record<string, unknown> = {}) => {
      setMessages(prev => [
        ...prev,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          role,
          content,
          ...meta,
        },
      ]);
    },
    []
  );

  const ensureSession = useCallback(async () => {
    const assistant = await ensureDevAIAssistantProvider();
    setProvider(getActiveProviderName());
    if (!sessionRef.current) {
      sessionRef.current = assistant.createSession({
        id: `dev-ui-${Date.now()}`,
      });
    }
    return sessionRef.current;
  }, []);

  const cancelStream = useCallback(() => {
    handleRef.current?.cancel?.('user cancelled');
    handleRef.current = null;
    setStreaming(false);
  }, []);

  const sendPrompt = useCallback(
    async (promptText?: string) => {
      const question = (promptText || input).trim();
      if (!question || streaming) {
        return;
      }

      setError(null);
      setInput('');
      appendMessage('user', question);
      setPartial('');
      setStreaming(true);

      try {
        const session = await ensureSession();

        const handle = session.streamMessage(question, {
          onToken: (token: string) => {
            setPartial(prev => prev + token);
          },
          onToolResult: (result: {
            name: string;
            content: unknown;
            isError: boolean;
          }) => {
            appendMessage('tool', result.name, {
              toolPayload: result.content,
              isError: result.isError,
            });
          },
          onComplete: (response: { message?: { content?: string } }) => {
            const finalText = response?.message?.content || '';
            setPartial('');
            appendMessage('assistant', finalText || '(empty response)');
            setStreaming(false);
            handleRef.current = null;
          },
          onError: (err: { code?: string; message: string }) => {
            setStreaming(false);
            setPartial('');
            setError(`${err.code || 'ERROR'}: ${err.message}`);
            appendMessage('assistant', `Error: ${err.message}`);
            handleRef.current = null;
          },
        });

        handleRef.current = handle;
        await handle.promise;
      } catch (err) {
        setStreaming(false);
        setPartial('');
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        appendMessage('assistant', `Error: ${message}`);
        handleRef.current = null;
      }
    },
    [appendMessage, ensureSession, input, streaming]
  );

  const clearChat = useCallback(() => {
    cancelStream();
    sessionRef.current?.clear?.();
    sessionRef.current = null;
    setMessages([]);
    setPartial('');
    setError(null);
  }, [cancelStream]);

  if (!isDev()) {
    return null;
  }

  return (
    <>
      <Pressable
        accessibilityLabel="Open AI debug assistant"
        onPress={() => setOpen(true)}
        style={[styles.fab, { bottom: fabBottom }]}
      >
        <Text style={styles.fabText}>AI</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => {
          cancelStream();
          setOpen(false);
        }}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <KeyboardAvoidingView
              style={styles.flex}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Debug AI Assistant</Text>
                  <Text style={styles.subtitle}>
                    provider: {provider} · tools enabled
                  </Text>
                </View>
                <View style={styles.headerActions}>
                  <Pressable onPress={clearChat} style={styles.headerBtn}>
                    <Text style={styles.headerBtnText}>Clear</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      cancelStream();
                      setOpen(false);
                    }}
                    style={styles.headerBtn}
                  >
                    <Text style={styles.headerBtnText}>Close</Text>
                  </Pressable>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickRow}
              >
                {quickPrompts.map(prompt => (
                  <Pressable
                    key={prompt}
                    disabled={streaming}
                    onPress={() => sendPrompt(prompt)}
                    style={styles.quickChip}
                  >
                    <Text style={styles.quickChipText} numberOfLines={2}>
                      {prompt}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <ScrollView
                ref={scrollRef}
                style={styles.messages}
                contentContainerStyle={styles.messagesContent}
                onContentSizeChange={() =>
                  scrollRef.current?.scrollToEnd?.({ animated: true })
                }
              >
                {messages.length === 0 && !partial ? (
                  <Text style={styles.empty}>
                    Ask about network logs, connectivity, or API failures. The
                    model can call registered tools automatically.
                  </Text>
                ) : null}

                {messages.map(message => (
                  <View
                    key={message.id}
                    style={[
                      styles.bubble,
                      message.role === 'user'
                        ? styles.userBubble
                        : message.role === 'tool'
                          ? styles.toolBubble
                          : styles.assistantBubble,
                    ]}
                  >
                    <Text style={styles.bubbleRole}>{message.role}</Text>
                    <Text style={styles.bubbleText}>{message.content}</Text>
                    {message.toolPayload ? (
                      <Text style={styles.toolJson} numberOfLines={8}>
                        {typeof message.toolPayload === 'string'
                          ? message.toolPayload
                          : JSON.stringify(message.toolPayload, null, 2)}
                      </Text>
                    ) : null}
                  </View>
                ))}

                {partial ? (
                  <View style={[styles.bubble, styles.assistantBubble]}>
                    <Text style={styles.bubbleRole}>assistant · streaming</Text>
                    <Text style={styles.bubbleText}>{partial}</Text>
                  </View>
                ) : null}

                {streaming ? (
                  <View style={styles.streamingRow}>
                    <ActivityIndicator color="#2680EB" />
                    <Text style={styles.streamingText}>Thinking…</Text>
                  </View>
                ) : null}

                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </ScrollView>

              <View style={styles.composer}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask the AI assistant…"
                  placeholderTextColor="#FFFFFF66"
                  style={styles.input}
                  multiline
                  editable={!streaming}
                  onSubmitEditing={() => sendPrompt()}
                />
                {streaming ? (
                  <Pressable onPress={cancelStream} style={styles.sendBtnDanger}>
                    <Text style={styles.sendBtnText}>Stop</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => sendPrompt()}
                    style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
                    disabled={!input.trim()}
                  >
                    <Text style={styles.sendBtnText}>Send</Text>
                  </Pressable>
                )}
              </View>
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2680EB',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 8,
  },
  fabText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#000000CC',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    minHeight: '70%',
    backgroundColor: '#101318',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    paddingTop: Platform.OS === 'ios' ? 44 : 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FFFFFF33',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: '#FFFFFF99',
    fontSize: 11,
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF22',
  },
  headerBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  quickRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  quickChip: {
    maxWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFFFFF14',
    marginRight: 8,
  },
  quickChipText: {
    color: '#FFFFFF',
    fontSize: 11,
  },
  messages: { flex: 1 },
  messagesContent: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    gap: 10,
  },
  empty: {
    color: '#FFFFFF66',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  bubble: {
    borderRadius: 12,
    padding: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2680EB',
    maxWidth: '88%',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF14',
    maxWidth: '92%',
  },
  toolBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F3A2E',
    maxWidth: '92%',
  },
  bubbleRole: {
    color: '#FFFFFF99',
    fontSize: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  bubbleText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
  },
  toolJson: {
    marginTop: 6,
    color: '#9AE6B4',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  streamingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  streamingText: {
    color: '#FFFFFF99',
    fontSize: 12,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 12,
    marginTop: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#FFFFFF33',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    backgroundColor: '#FFFFFF14',
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: '#2680EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendBtnDanger: {
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
