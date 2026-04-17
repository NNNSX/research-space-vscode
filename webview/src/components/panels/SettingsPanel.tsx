import React, { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useCanvasStore } from '../../stores/canvas-store';
import { usePetStore } from '../../stores/pet-store';
import { postMessage } from '../../bridge';
import type { CustomProviderConfig } from '../../../../src/core/canvas-model';
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { getAutoModelLabel, getConcreteProviderModelLabel, getProviderDisplayName } from '../../utils/model-labels';
import { PET_TYPES, getPetType, GROUND_THEMES } from '../../pet/pet-types';
import type { PetTypeId, GroundThemeId } from '../../pet/pet-types';

// ── Helpers ────────────────────────────────────────────────────────────────

function sendSetting(key: string, value: unknown) {
  postMessage({ type: 'updateSettings', key, value });
}

function useDebounced(fn: (k: string, v: unknown) => void, delay: number) {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return useCallback((k: string, v: unknown) => {
    if (t.current) { clearTimeout(t.current); }
    t.current = setTimeout(() => fn(k, v), delay);
  }, [fn, delay]);
}

// ── Common styles ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border, transparent)',
  borderRadius: 3, padding: '4px 7px', fontSize: 12, boxSizing: 'border-box',
};
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--vscode-descriptionForeground)', marginBottom: 3,
};
const smallBtnStyle: React.CSSProperties = {
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
  border: '1px solid var(--vscode-button-border, transparent)',
  borderRadius: 3, padding: '3px 7px', fontSize: 11, cursor: 'pointer', flexShrink: 0,
};

// ── ModelSelect — unified model dropdown ─────────────────────────────────

function ModelSelect({ providerId, value, onChange }: {
  providerId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const modelCache = useCanvasStore(s => s.modelCache);
  const settings = useCanvasStore(s => s.settings);
  const models = modelCache[providerId];
  const autoLabel = getAutoModelLabel(providerId, settings, modelCache, {
    emptyStateText: providerId === 'copilot'
      ? '自动（正在加载 Copilot 具体模型…）'
      : '自动（当前未配置具体模型）',
  });
  const options: SearchableSelectOption[] = [
    { value: '', label: autoLabel, keywords: [providerId, '自动', '默认'] },
    ...(models ?? []).map(m => ({
      value: m.id,
      label: m.id,
      title: [m.name && m.name !== m.id ? m.name : '', m.description ?? ''].filter(Boolean).join(' · '),
      keywords: [m.id, m.name ?? '', m.description ?? ''],
    })),
  ];
  if (!models && value) {
    options.push({ value, label: value, keywords: [value] });
  }

  const refresh = () => postMessage({ type: 'requestModels', provider: providerId });

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <SearchableSelect
        value={value}
        options={options}
        onChange={onChange}
        placeholder="搜索模型..."
        style={{ ...selectStyle, flex: 1 }}
      />
      <button onClick={refresh} title="刷新模型列表" style={smallBtnStyle}>🔄</button>
    </div>
  );
}

// ── MultimodalModelSelect — simple fixed-options select for multimodal tools ──

function MultimodalModelSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const selectOptions: SearchableSelectOption[] = options.map(option => ({
    value: option.value,
    label: option.value,
    title: option.label,
    keywords: [option.value, option.label],
  }));
  return (
    <SearchableSelect
      style={selectStyle}
      value={value}
      options={selectOptions}
      onChange={onChange}
      placeholder="搜索模型..."
    />
  );
}



function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', background: 'none', border: 'none',
          color: 'var(--vscode-sideBarSectionHeader-foreground)',
          cursor: 'pointer', fontSize: 11, fontWeight: 700, textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && (
        <div style={{ padding: '4px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

// ── CustomProviderCard ─────────────────────────────────────────────────────

function CustomProviderCard({ cp, allProviders, onChange, onDelete }: {
  cp: CustomProviderConfig;
  allProviders: CustomProviderConfig[];
  onChange: (updated: CustomProviderConfig[]) => void;
  onDelete: () => void;
}) {
  const [showKey, setShowKey] = useState(false);

  const update = (patch: Partial<CustomProviderConfig>) => {
    const updated = allProviders.map(p => p.id === cp.id ? { ...p, ...patch } : p);
    onChange(updated);
  };

  return (
    <div style={{
      border: '1px solid var(--vscode-panel-border)', borderRadius: 5,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
      background: 'var(--vscode-editor-background)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
          defaultValue={cp.name}
          placeholder="服务商名称"
          onBlur={e => update({ name: e.target.value })}
        />
        <button onClick={onDelete} title="删除服务商" style={{ ...smallBtnStyle, color: 'var(--vscode-errorForeground)' }}>
          ✕
        </button>
      </div>

      <Field label="Base URL">
        <input
          style={inputStyle}
          defaultValue={cp.baseUrl}
          placeholder="https://aihubmix.com/v1"
          onBlur={e => update({ baseUrl: e.target.value })}
        />
      </Field>

      <Field label="API Key">
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            type={showKey ? 'text' : 'password'}
            defaultValue={cp.apiKey}
            placeholder="sk-..."
            onBlur={e => update({ apiKey: e.target.value })}
          />
          <button onClick={() => setShowKey(v => !v)} style={smallBtnStyle}>
            {showKey ? '👁' : '🔒'}
          </button>
        </div>
      </Field>

      <Field label="默认模型">
        <ModelSelect
          providerId={cp.id}
          value={cp.defaultModel}
          onChange={v => update({ defaultModel: v })}
        />
      </Field>
    </div>
  );
}

// ── SettingsPanel ─────────────────────────────────────────────────────────

const AIHUBMIX_PRESET: Omit<CustomProviderConfig, 'id' | 'apiKey' | 'defaultModel'> = {
  name: 'AIHub Mix',
  baseUrl: 'https://aihubmix.com/v1',
};

function buildProviderOptions(customProviders: CustomProviderConfig[]): SearchableSelectOption[] {
  return [
    { value: 'copilot', label: 'GitHub Copilot', keywords: ['copilot', 'github'] },
    { value: 'anthropic', label: 'Anthropic Claude', keywords: ['anthropic', 'claude'] },
    { value: 'ollama', label: 'Ollama（本地）', keywords: ['ollama', 'local', '本地'] },
    ...customProviders.map(cp => ({
      value: cp.id,
      label: cp.name,
      title: cp.baseUrl,
      keywords: [cp.id, cp.name, cp.baseUrl],
    })),
  ];
}

export function SettingsPanel() {
  const settings = useCanvasStore(s => s.settings);
  const settingsPanelOpen = useCanvasStore(s => s.settingsPanelOpen);
  const setSettingsPanelOpen = useCanvasStore(s => s.setSettingsPanelOpen);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const debouncedSend = useDebounced(sendSetting, 500);

  // Auto-fetch model lists when panel opens
  useEffect(() => {
    if (!settingsPanelOpen) { return; }
    postMessage({ type: 'requestModels', provider: 'copilot' });
    if (settings?.anthropicApiKey) {
      postMessage({ type: 'requestModels', provider: 'anthropic' });
    }
    postMessage({ type: 'requestModels', provider: 'ollama' });
    for (const cp of (settings?.customProviders ?? [])) {
      postMessage({ type: 'requestModels', provider: cp.id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsPanelOpen]);

  if (!settingsPanelOpen) { return null; }

  if (!settings) {
    return (
      <div style={panelStyle}>
        <PanelHeader onClose={() => setSettingsPanelOpen(false)} />
        <div style={{ padding: 16, color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
          加载设置中…
        </div>
      </div>
    );
  }

  const customProviders = settings.customProviders ?? [];
  const providerOptions = buildProviderOptions(customProviders);

  const saveCustomProviders = (list: CustomProviderConfig[]) => {
    sendSetting('customProviders', list);
  };

  const addCustomProvider = (preset?: typeof AIHUBMIX_PRESET) => {
    const newOne: CustomProviderConfig = {
      id: uuid(),
      name: preset?.name ?? 'Custom Provider',
      baseUrl: preset?.baseUrl ?? '',
      apiKey: '',
      defaultModel: '',
    };
    saveCustomProviders([...customProviders, newOne]);
  };

  const hasAihubMix = customProviders.some(cp =>
    cp.baseUrl.includes('aihubmix.com') || cp.name.toLowerCase().includes('aihub')
  );

  return (
    <div style={panelStyle}>
      <PanelHeader onClose={() => setSettingsPanelOpen(false)} />

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── LLM 文本服务商 ─────────────────────────────────────────── */}
        <div style={{
          padding: '8px 14px 4px',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--vscode-terminal-ansiBlue)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          LLM 文本服务商
        </div>

        {/* Global Provider */}
        <Section title="AI 服务商">
          <Field label="全局默认服务商">
            <SearchableSelect
              style={selectStyle}
              value={settings.globalProvider}
              options={providerOptions}
              onChange={v => sendSetting('globalProvider', v)}
              placeholder="搜索服务商..."
            />
          </Field>
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
            功能节点可单独覆盖此设置。
          </div>
        </Section>

        {/* Copilot */}
        <Section title="GitHub Copilot">
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
            零配置，需要安装并登录 GitHub Copilot 扩展。
          </div>
          <Field label="默认模型">
            <ModelSelect
              providerId="copilot"
              value={settings.copilotModel}
              onChange={v => sendSetting('copilotModel', v)}
            />
          </Field>
        </Section>

        {/* Anthropic */}
        <Section title="Anthropic Claude">
          <Field label="API Key">
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                key={settings.anthropicApiKey}
                style={{ ...inputStyle, flex: 1 }}
                type={showAnthropicKey ? 'text' : 'password'}
                defaultValue={settings.anthropicApiKey}
                placeholder="sk-ant-..."
                onChange={e => debouncedSend('anthropicApiKey', e.target.value)}
              />
              <button onClick={() => setShowAnthropicKey(v => !v)} style={smallBtnStyle}>
                {showAnthropicKey ? '👁' : '🔒'}
              </button>
            </div>
          </Field>
          <Field label="默认模型">
            <ModelSelect
              providerId="anthropic"
              value={settings.anthropicModel}
              onChange={v => sendSetting('anthropicModel', v)}
            />
          </Field>
        </Section>

        {/* Ollama */}
        <Section title="Ollama（本地）">
          <Field label="Base URL">
            <input
              key={settings.ollamaBaseUrl}
              style={inputStyle}
              defaultValue={settings.ollamaBaseUrl}
              placeholder="http://localhost:11434"
              onBlur={e => sendSetting('ollamaBaseUrl', e.target.value)}
            />
          </Field>
          <Field label="默认模型">
            <ModelSelect
              providerId="ollama"
              value={settings.ollamaModel}
              onChange={v => sendSetting('ollamaModel', v)}
            />
          </Field>
        </Section>

        {/* Custom Providers */}
        <Section title="自定义服务商（OpenAI 兼容）">
          {customProviders.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
              暂无自定义提供商。可添加任何 OpenAI 兼容接口。
            </div>
          )}
          {customProviders.map(cp => (
            <CustomProviderCard
              key={cp.id}
              cp={cp}
              allProviders={customProviders}
              onChange={saveCustomProviders}
              onDelete={() => saveCustomProviders(customProviders.filter(p => p.id !== cp.id))}
            />
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {!hasAihubMix && (
              <button
                onClick={() => addCustomProvider(AIHUBMIX_PRESET)}
                style={{ ...smallBtnStyle, fontSize: 11 }}
              >
                + AIHub Mix
              </button>
            )}
            <button
              onClick={() => addCustomProvider()}
              style={{ ...smallBtnStyle, fontSize: 11 }}
            >
              + 添加自定义提供商
            </button>
          </div>
        </Section>

        {/* ── 多模态工具 ───────────────────────────────────────────── */}
        <div style={{
          padding: '8px 14px 4px',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--vscode-terminal-ansiMagenta)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          多模态工具
        </div>

        {/* Multimodal — AIHubMix */}
        <Section title="AIHubMix 配置">
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
            图像生成 / 图像编辑 / TTS / STT / 视频生成等多模态工具专用，与上方 LLM 服务商相互独立。
          </div>
          <Field label="AIHubMix API Key">
            <AiHubMixKeyInput
              value={settings.aiHubMixApiKey ?? ''}
              onChange={v => debouncedSend('aiHubMixApiKey', v)}
            />
          </Field>
          <Field label="图像生成默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixImageGenModel || 'gemini-3.1-flash-image-preview'}
              options={[
                { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
                { value: 'gemini-3-pro-image-preview',     label: 'Gemini 3 Pro Image Preview' },
                { value: 'doubao-seedream-5.0-lite',       label: 'Doubao Seedream 5.0 Lite' },
              ]}
              onChange={v => sendSetting('aiHubMixImageGenModel', v)}
            />
          </Field>
          <Field label="图像编辑默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixImageEditModel || 'gemini-3.1-flash-image-preview'}
              options={[
                { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
                { value: 'gemini-3-pro-image-preview',     label: 'Gemini 3 Pro Image Preview' },
                { value: 'doubao-seedream-5.0-lite',       label: 'Doubao Seedream 5.0 Lite' },
              ]}
              onChange={v => sendSetting('aiHubMixImageEditModel', v)}
            />
          </Field>
          <Field label="多图融合默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixImageFusionModel || 'doubao-seedream-4-0-250828'}
              options={[
                { value: 'doubao-seedream-4-0-250828', label: 'Doubao Seedream 4.0' },
                { value: 'doubao-seedream-4-5-250828', label: 'Doubao Seedream 4.5' },
                { value: 'doubao-seedream-5.0-lite',   label: 'Doubao Seedream 5.0 Lite' },
              ]}
              onChange={v => sendSetting('aiHubMixImageFusionModel', v)}
            />
          </Field>
          <Field label="组图输出默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixImageGroupModel || 'doubao-seedream-4-0-250828'}
              options={[
                { value: 'doubao-seedream-4-0-250828', label: 'Doubao Seedream 4.0' },
                { value: 'doubao-seedream-4-5-250828', label: 'Doubao Seedream 4.5' },
                { value: 'doubao-seedream-5.0-lite',   label: 'Doubao Seedream 5.0 Lite' },
              ]}
              onChange={v => sendSetting('aiHubMixImageGroupModel', v)}
            />
          </Field>
          <Field label="TTS 默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixTtsModel || 'gpt-4o-mini-tts'}
              options={[
                { value: 'gpt-4o-mini-tts', label: 'GPT-4o Mini TTS' },
                { value: 'tts-1',           label: 'tts-1' },
              ]}
              onChange={v => sendSetting('aiHubMixTtsModel', v)}
            />
          </Field>
          <Field label="STT 默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixSttModel || 'whisper-large-v3-turbo'}
              options={[
                { value: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
                { value: 'whisper-large-v3',       label: 'Whisper Large v3' },
              ]}
              onChange={v => sendSetting('aiHubMixSttModel', v)}
            />
          </Field>
          <Field label="视频生成默认模型">
            <MultimodalModelSelect
              value={settings.aiHubMixVideoGenModel || 'doubao-seedance-2-0-260128'}
              options={[
                { value: 'doubao-seedance-2-0-260128',      label: 'Doubao Seedance 2.0' },
                { value: 'doubao-seedance-2-0-fast-260128', label: 'Doubao Seedance 2.0 Fast' },
              ]}
              onChange={v => sendSetting('aiHubMixVideoGenModel', v)}
            />
          </Field>
        </Section>

        {/* ── 画布 ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '8px 14px 4px',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--vscode-descriptionForeground)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          其他
        </div>

        {/* Canvas */}
        <Section title="画布">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={e => sendSetting('autoSave', e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>自动保存（每 3 分钟）</span>
          </label>
        </Section>

        {/* ── 宠物伴侣 ─────────────────────────────────────────────── */}
        <div style={{
          padding: '8px 14px 4px',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--vscode-terminal-ansiGreen)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          宠物伴侣
        </div>

        <PetSettingsSection />

      </div>
    </div>
  );
}

// ── AiHubMixKeyInput ────────────────────────────────────────────────────────

function AiHubMixKeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input
        key={value}
        style={{ ...inputStyle, flex: 1 }}
        type={show ? 'text' : 'password'}
        defaultValue={value}
        placeholder="sk-..."
        onChange={e => onChange(e.target.value)}
      />
      <button onClick={() => setShow(v => !v)} style={smallBtnStyle}>
        {show ? '👁' : '🔒'}
      </button>
    </div>
  );
}

// ── PanelHeader ────────────────────────────────────────────────────────────

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '10px 14px',
      borderBottom: '1px solid var(--vscode-panel-border)', flexShrink: 0,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-sideBarSectionHeader-foreground)', flex: 1 }}>
        ⚙ 设置
      </span>
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', color: 'var(--vscode-descriptionForeground)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
      >
        ✕
      </button>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', right: 0, top: 0, bottom: 0, width: 320,
  background: 'var(--vscode-sideBar-background)',
  borderLeft: '1px solid var(--vscode-panel-border)',
  display: 'flex', flexDirection: 'column', zIndex: 20,
  boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
};

// ── PetSettingsSection ───────────────────────────────────────────────────────

function PetSettingsSection() {
  const { enabled, setEnabled, pet, setPetType, setPetName, restReminderMin, setRestReminderMin, groundTheme, setGroundTheme } = usePetStore();
  const settings = useCanvasStore(s => s.settings);
  const modelCache = useCanvasStore(s => s.modelCache);
  const [nameInput, setNameInput] = useState(pet.petName);
  const nameTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleNameChange = (v: string) => {
    setNameInput(v);
    if (nameTimer.current) { clearTimeout(nameTimer.current); }
    nameTimer.current = setTimeout(() => setPetName(v), 500);
  };

  // Resolve effective pet provider for model list fetching
  const resolvedPetProvider = (settings?.petAiProvider && settings.petAiProvider !== 'auto')
    ? settings.petAiProvider
    : settings?.globalProvider ?? 'copilot';
  const providerOptions = buildProviderOptions(settings?.customProviders ?? []);
  const resolvedPetModel = getConcreteProviderModelLabel(resolvedPetProvider, settings ?? null, modelCache);
  const petProviderAutoLabel = `自动（跟随全局：${getProviderDisplayName(
    settings?.globalProvider ?? 'copilot',
    settings ?? null
  )}${resolvedPetModel ? ` · ${resolvedPetModel}` : ''})`;

  return (
    <>
      <Section title="宠物开关">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>启用宠物面板</span>
        </label>
      </Section>

      {enabled && (
        <>
          <Section title="宠物类型">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {PET_TYPES.map(p => {
                const unlocked = pet.level >= p.unlockLevel;
                const active = pet.petType === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={unlocked ? () => setPetType(p.id) : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px', borderRadius: 4, fontSize: 12,
                      cursor: unlocked ? 'pointer' : 'default',
                      opacity: unlocked ? 1 : 0.4,
                      background: active ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                      color: active ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
                      border: active ? '1px solid var(--vscode-focusBorder)' : '1px solid transparent',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{p.emoji}</span>
                    <span style={{ flex: 1 }}>{p.name} — {p.defaultName}</span>
                    {!unlocked && (
                      <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                        🔒 Lv.{p.unlockLevel}
                      </span>
                    )}
                    {active && <span style={{ fontSize: 10 }}>✓</span>}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="场景主题">
            <SearchableSelect
              style={selectStyle}
              value={groundTheme}
              options={GROUND_THEMES.map(theme => ({
                value: theme.id,
                label: theme.name,
                keywords: [theme.id, theme.name],
              }))}
              onChange={v => setGroundTheme(v as GroundThemeId)}
              placeholder="搜索主题..."
            />
          </Section>

          <Section title="宠物名字">
            <input
              style={inputStyle}
              value={nameInput}
              onChange={e => handleNameChange(e.target.value)}
              placeholder={getPetType(pet.petType).defaultName}
            />
          </Section>

          <Section title="休息提醒（分钟，0 = 关闭）">
            <input
              style={{ ...inputStyle, width: 80 }}
              type="number"
              min={0}
              max={180}
              value={restReminderMin}
              onChange={e => setRestReminderMin(Number(e.target.value) || 0)}
            />
          </Section>

          <Section title="宠物 AI">
            <div style={{ marginBottom: 6 }}>
              <div style={labelStyle}>AI 服务商</div>
              <SearchableSelect
                style={selectStyle}
                value={settings?.petAiProvider ?? 'auto'}
                options={[
                  { value: 'auto', label: petProviderAutoLabel, keywords: ['auto', '自动', '全局'] },
                  ...providerOptions,
                ]}
                onChange={v => sendSetting('petAiProvider', v)}
                placeholder="搜索服务商..."
              />
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={labelStyle}>AI 模型</div>
              <ModelSelect
                providerId={resolvedPetProvider}
                value={settings?.petAiModel ?? ''}
                onChange={v => sendSetting('petAiModel', v)}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              宠物对话使用独立的服务商和模型，可选择轻量模型节省开销。
            </div>
          </Section>

          <Section title="宠物状态">
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>等级: Lv.{pet.level} | 经验: {Math.floor(pet.exp)}</span>
              <span>心情: {Math.round(pet.mood)} | 精力: {Math.round(pet.energy)}</span>
              <span>已解锁宠物: {pet.unlockedPets.length}/{PET_TYPES.length}</span>
              <span>总工作时间: {Math.floor(pet.totalWorkMinutes)} 分钟</span>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
