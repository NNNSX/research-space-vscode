import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useCanvasStore } from '../../stores/canvas-store';
import { usePetStore, type PetDisplayMode } from '../../stores/pet-store';
import { onMessage, postMessage } from '../../bridge';
import type { ConversionDiagnosticStatus, ConversionDiagnosticsReport, CustomProviderConfig, SettingsSnapshot } from '../../../../src/core/canvas-model';
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { getAutoModelLabel, getConcreteProviderModelLabel, getFavoriteModelsForProvider, getProviderDisplayName, orderModelsByIds } from '../../utils/model-labels';
import { PET_TYPES, getPetType, GROUND_THEMES } from '../../pet/pet-types';
import type { PetTypeId, GroundThemeId } from '../../pet/pet-types';
import type { PetSuggestionActivity } from '../../pet/pet-event-policy';
import { getPetLevelProgress } from '../../../../src/core/pet-state';
import { getPetGrowthSummary, type PetGrowthMilestoneKind } from '../../../../src/core/pet-growth';
import { buildCanvasHealthReport, type CanvasHealthReport, type CanvasHealthSeverity } from '../../utils/canvas-health';

// ── Helpers ────────────────────────────────────────────────────────────────

function sendSetting(key: string, value: unknown) {
  postMessage({ type: 'updateSettings', key, value });
}

function useDebounced(fn: (k: string, v: unknown) => void, delay: number) {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastArgs = useRef<[string, unknown] | null>(null);

  const schedule = useCallback((k: string, v: unknown) => {
    lastArgs.current = [k, v];
    if (t.current) { clearTimeout(t.current); }
    t.current = setTimeout(() => {
      t.current = undefined;
      if (!lastArgs.current) { return; }
      const [nextKey, nextValue] = lastArgs.current;
      lastArgs.current = null;
      fn(nextKey, nextValue);
    }, delay);
  }, [fn, delay]);

  const flush = useCallback(() => {
    if (t.current) {
      clearTimeout(t.current);
      t.current = undefined;
    }
    if (!lastArgs.current) { return false; }
    const [nextKey, nextValue] = lastArgs.current;
    lastArgs.current = null;
    fn(nextKey, nextValue);
    return true;
  }, [fn]);

  return useMemo(() => ({ schedule, flush }), [flush, schedule]);
}

type SettingsPersistStatus = 'saved' | 'pending' | 'saving';

type SettingsPersistenceContextValue = {
  status: SettingsPersistStatus;
  lastSavedAt: number | null;
  saveSetting: (key: string, value: unknown) => void;
  queueSetting: (key: string, value: unknown) => void;
  saveNow: () => void;
};

const SettingsPersistenceContext = createContext<SettingsPersistenceContextValue | null>(null);

function useSettingsPersistence() {
  const context = useContext(SettingsPersistenceContext);
  if (!context) {
    throw new Error('useSettingsPersistence must be used within SettingsPersistenceContext');
  }
  return context;
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

function conversionStatusLabel(status: ConversionDiagnosticStatus): string {
  switch (status) {
    case 'ok': return '可用';
    case 'warning': return '需注意';
    case 'error': return '不可用';
    case 'unknown': return '未检测';
  }
}

function conversionStatusIcon(status: ConversionDiagnosticStatus): string {
  switch (status) {
    case 'ok': return '✓';
    case 'warning': return '!';
    case 'error': return '×';
    case 'unknown': return '?';
  }
}

function conversionStatusColor(status: ConversionDiagnosticStatus): string {
  switch (status) {
    case 'ok': return 'var(--vscode-terminal-ansiGreen)';
    case 'warning': return 'var(--vscode-terminal-ansiYellow)';
    case 'error': return 'var(--vscode-errorForeground, #f48771)';
    case 'unknown': return 'var(--vscode-descriptionForeground)';
  }
}

function canvasHealthSeverityLabel(severity: CanvasHealthSeverity): string {
  switch (severity) {
    case 'error': return '错误';
    case 'warning': return '警告';
    case 'info': return '提示';
  }
}

function canvasHealthSeverityColor(severity: CanvasHealthSeverity): string {
  switch (severity) {
    case 'error': return 'var(--vscode-errorForeground, #f48771)';
    case 'warning': return 'var(--vscode-terminal-ansiYellow)';
    case 'info': return 'var(--vscode-descriptionForeground)';
  }
}

// ── ModelSelect — unified model dropdown ─────────────────────────────────

function ModelSelect({ providerId, value, onChange }: {
  providerId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const modelCache = useCanvasStore(s => s.modelCache);
  const requestModelCache = useCanvasStore(s => s.requestModelCache);
  const settings = useCanvasStore(s => s.settings);
  const models = modelCache[providerId];
  const autoLabel = getAutoModelLabel(providerId, settings, modelCache, {
    emptyStateText: providerId === 'copilot'
      ? '自动（正在加载 Copilot 具体模型…）'
      : '自动（当前未配置具体模型）',
  });
  const options: SearchableSelectOption[] = [
    ...(providerId === 'copilot' ? [] : [{ value: '', label: autoLabel, keywords: [providerId, '自动', '默认'] }]),
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

  const refresh = () => requestModelCache(providerId, { force: true });

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

function SettingsEntryCard({
  title,
  description,
  summary,
  accent,
  onOpen,
}: {
  title: string;
  description: string;
  summary: string;
  accent: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${accent}55`,
        background: 'var(--vscode-editor-background)',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 12, color: 'var(--vscode-foreground)' }}>{title}</strong>
        <span style={{ fontSize: 11, color: accent }}>打开 ›</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
        {description}
      </div>
      <div style={{ fontSize: 10, color: 'var(--vscode-foreground)', opacity: 0.85 }}>
        {summary}
      </div>
    </button>
  );
}

function SettingsSubModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={modalBackdropStyle}>
      <div style={modalPanelStyle}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          <strong style={{ fontSize: 13, flex: 1 }}>{title}</strong>
          <button onClick={onClose} style={smallBtnStyle}>关闭</button>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: 'min(78vh, 760px)' }}>
          {children}
        </div>
        <SettingsSaveBar compact />
      </div>
    </div>
  );
}

function SettingsSaveBar({ compact = false }: { compact?: boolean }) {
  const { status, lastSavedAt, saveNow } = useSettingsPersistence();

  const statusText = status === 'pending'
    ? '当前改动尚未确认保存'
    : status === 'saving'
      ? '正在保存设置…'
      : lastSavedAt
        ? `设置已保存 · ${new Date(lastSavedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}`
        : '设置已保存';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      padding: compact ? '8px 14px' : '10px 14px',
      borderTop: compact ? '1px solid var(--vscode-panel-border)' : undefined,
      borderBottom: compact ? undefined : '1px solid var(--vscode-panel-border)',
      background: status === 'pending'
        ? 'color-mix(in srgb, var(--vscode-editorWarning-foreground, #d29922) 10%, transparent)'
        : status === 'saving'
          ? 'color-mix(in srgb, var(--vscode-button-background, #0e639c) 10%, transparent)'
          : 'var(--vscode-sideBar-background)',
    }}>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--vscode-descriptionForeground)' }}>
        <div style={{ fontWeight: 600, color: 'var(--vscode-foreground)' }}>
          {statusText}
        </div>
        <div>
          设置仍会自动保存；同时保留一个“保存设置”按钮，方便你手动确认。
        </div>
      </div>
      <button
        onClick={saveNow}
        style={{
          ...smallBtnStyle,
          padding: '5px 10px',
          fontWeight: 600,
          background: status === 'saved'
            ? 'var(--vscode-button-secondaryBackground)'
            : 'var(--vscode-button-background)',
          color: status === 'saved'
            ? 'var(--vscode-button-secondaryForeground)'
            : 'var(--vscode-button-foreground)',
        }}
      >
        {status === 'saving' ? '保存中…' : '💾 保存设置'}
      </button>
    </div>
  );
}

function ModalTabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '10px 14px 0',
      borderBottom: '1px solid var(--vscode-panel-border)',
      flexWrap: 'wrap',
    }}>
      {tabs.map(tab => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            style={{
              background: active ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)',
              color: active ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)',
              border: '1px solid var(--vscode-button-border, transparent)',
              borderRadius: '8px 8px 0 0',
              padding: '6px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function FavoriteModelsModal({
  providerId,
  settings,
  onClose,
}: {
  providerId: string;
  settings: SettingsSnapshot;
  onClose: () => void;
}) {
  const modelCache = useCanvasStore(s => s.modelCache);
  const requestModelCache = useCanvasStore(s => s.requestModelCache);
  const requestDeleteConfirm = useCanvasStore(s => s.requestDeleteConfirm);
  const { saveSetting } = useSettingsPersistence();
  const providerName = getProviderDisplayName(providerId, settings);
  const models = modelCache[providerId] ?? [];
  const favoriteIds = getFavoriteModelsForProvider(providerId, settings, models);
  const [query, setQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    requestModelCache(providerId);
  }, [providerId, requestModelCache]);

  const saveFavoriteIds = (nextIds: string[]) => {
    saveSetting('favoriteModels', {
      ...(settings.favoriteModels ?? {}),
      [providerId]: nextIds,
    });
  };

  const selectedFavorites = orderModelsByIds(
    models.filter(model => favoriteIds.includes(model.id)),
    favoriteIds,
  );
  const filtered = models.filter(model => {
    const haystack = `${model.id} ${model.name ?? ''} ${model.description ?? ''}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const toggleFavorite = (modelId: string) => {
    if (favoriteIds.includes(modelId)) {
      saveFavoriteIds(favoriteIds.filter(id => id !== modelId));
    } else {
      saveFavoriteIds([...favoriteIds, modelId]);
    }
  };

  const moveFavorite = (modelId: string, direction: -1 | 1) => {
    const index = favoriteIds.indexOf(modelId);
    if (index < 0) { return; }
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= favoriteIds.length) { return; }
    const next = [...favoriteIds];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    saveFavoriteIds(next);
  };

  const reorderFavorite = (fromId: string, toId: string) => {
    if (fromId === toId) { return; }
    const fromIndex = favoriteIds.indexOf(fromId);
    const toIndex = favoriteIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) { return; }
    const next = [...favoriteIds];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    saveFavoriteIds(next);
  };

  return (
    <SettingsSubModal title={`常用模型 · ${providerName}`} onClose={onClose}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
          这里显示该服务商的完整模型列表；勾选后的模型会出现在功能节点的模型下拉中。未手动配置时，插件会先尝试按预置热门模型自动收口；若当前列表仍匹配不到，再回退显示全部模型。你也可以拖拽或上下移动，控制功能节点里模型的展示顺序。
        </div>
        <Section title={`已选常用模型（${selectedFavorites.length}）`}>
          {selectedFavorites.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
              还没有选中常用模型。勾选下方完整列表里的模型后，功能节点会优先只显示这些模型。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selectedFavorites.map((model, index) => (
                <div
                  key={model.id}
                  draggable
                  onDragStart={() => setDraggingId(model.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    if (draggingId) {
                      reorderFavorite(draggingId, model.id);
                    }
                    setDraggingId(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: draggingId === model.id ? '1px dashed var(--vscode-focusBorder)' : '1px solid var(--vscode-panel-border)',
                    background: 'var(--vscode-editor-background)',
                  }}
                >
                  <span title="拖拽排序" style={{ cursor: 'grab', fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>⋮⋮</span>
                  <span style={{ fontSize: 10, width: 18, color: 'var(--vscode-descriptionForeground)' }}>{index + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{model.id}</div>
                    {(model.name || model.description) && (
                      <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
                        {[model.name && model.name !== model.id ? model.name : '', model.description ?? ''].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => moveFavorite(model.id, -1)} style={smallBtnStyle} title="上移">↑</button>
                    <button onClick={() => moveFavorite(model.id, 1)} style={smallBtnStyle} title="下移">↓</button>
                    <button
                      onClick={() => requestDeleteConfirm({
                        title: '确认移除常用模型',
                        message: `确认将“${model.id}”从常用模型中移除？`,
                        confirmLabel: '移除',
                        onConfirm: () => toggleFavorite(model.id),
                      })}
                      style={smallBtnStyle}
                      title="移除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
        <input
          style={inputStyle}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索模型..."
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => saveFavoriteIds(models.map(model => model.id))}
            style={smallBtnStyle}
          >
            全选当前列表
          </button>
          <button
            onClick={() => requestDeleteConfirm({
              title: '确认清空常用模型',
              message: `确认清空“${providerName}”的常用模型列表？`,
              confirmLabel: '清空',
              onConfirm: () => saveFavoriteIds([]),
            })}
            style={smallBtnStyle}
          >
            清空
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(model => {
            const checked = favoriteIds.includes(model.id);
            return (
              <label
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: '1px solid var(--vscode-panel-border)',
                  background: checked ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-editor-background)',
                  color: checked ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFavorite(model.id)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {model.id}
                    {checked && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                        #{favoriteIds.indexOf(model.id) + 1}
                      </span>
                    )}
                  </div>
                  {(model.name || model.description) && (
                    <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.4 }}>
                      {[model.name && model.name !== model.id ? model.name : '', model.description ?? ''].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>没有匹配到模型。</div>
          )}
        </div>
      </div>
    </SettingsSubModal>
  );
}

// ── CustomProviderCard ─────────────────────────────────────────────────────

function CustomProviderCard({ cp, allProviders, onChange, onDelete, onManageFavorites }: {
  cp: CustomProviderConfig;
  allProviders: CustomProviderConfig[];
  onChange: (updated: CustomProviderConfig[]) => void;
  onDelete: () => void;
  onManageFavorites: () => void;
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ModelSelect
            providerId={cp.id}
            value={cp.defaultModel}
            onChange={v => update({ defaultModel: v })}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onManageFavorites} style={smallBtnStyle}>⭐ 常用模型</button>
          </div>
        </div>
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
    { value: 'omlx', label: 'oMLX（本地）', keywords: ['omlx', 'local', '本地'] },
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
  const canvasFile = useCanvasStore(s => s.canvasFile);
  const settingsPanelOpen = useCanvasStore(s => s.settingsPanelOpen);
  const setSettingsPanelOpen = useCanvasStore(s => s.setSettingsPanelOpen);
  const settingsPanelDetailView = useCanvasStore(s => s.settingsPanelDetailView);
  const requestDeleteConfirm = useCanvasStore(s => s.requestDeleteConfirm);
  const requestModelCache = useCanvasStore(s => s.requestModelCache);
  const applyLowRiskCanvasHealthRepairs = useCanvasStore(s => s.applyLowRiskCanvasHealthRepairs);
  const petEnabled = usePetStore(s => s.enabled);
  const petType = usePetStore(s => s.pet.petType);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOmlxKey, setShowOmlxKey] = useState(false);
  const [showMineruToken, setShowMineruToken] = useState(false);
  const [detailView, setDetailView] = useState<'llm' | 'multimodal' | 'explosion' | 'canvas' | 'pet' | null>(null);
  const [favoriteProviderId, setFavoriteProviderId] = useState<string | null>(null);
  const [llmTab, setLlmTab] = useState<'overview' | 'builtin' | 'custom'>('overview');
  const [settingsPersistStatus, setSettingsPersistStatus] = useState<SettingsPersistStatus>('saved');
  const [settingsSavedAt, setSettingsSavedAt] = useState<number | null>(null);
  const [conversionDiagnostics, setConversionDiagnostics] = useState<ConversionDiagnosticsReport | null>(null);
  const [conversionDiagnosticsLoading, setConversionDiagnosticsLoading] = useState(false);
  const [conversionDiagnosticsError, setConversionDiagnosticsError] = useState<string | null>(null);
  const [canvasHealthReport, setCanvasHealthReport] = useState<CanvasHealthReport | null>(null);
  const firstSettingsSnapshotRef = useRef(true);

  const saveSetting = useCallback((key: string, value: unknown) => {
    setSettingsPersistStatus('saving');
    sendSetting(key, value);
  }, []);
  const debouncedSend = useDebounced(saveSetting, 500);
  const queueSetting = useCallback((key: string, value: unknown) => {
    setSettingsPersistStatus('pending');
    debouncedSend.schedule(key, value);
  }, [debouncedSend]);
  const saveSettingsNow = useCallback(() => {
    setSettingsPersistStatus('saving');
    const flushed = debouncedSend.flush();
    if (!flushed) {
      postMessage({ type: 'requestSettingsSnapshot' });
    }
  }, [debouncedSend]);

  const requestConversionDiagnostics = useCallback(() => {
    setConversionDiagnosticsLoading(true);
    setConversionDiagnosticsError(null);
    postMessage({ type: 'requestConversionDiagnostics' });
  }, []);

  const runCanvasHealthCheck = useCallback(() => {
    setCanvasHealthReport(buildCanvasHealthReport(canvasFile));
  }, [canvasFile]);

  const confirmLowRiskCanvasHealthRepair = useCallback(() => {
    if (!canvasHealthReport) { return; }
    const lowRiskCount = canvasHealthReport.repairPlan.filter(plan => plan.risk === 'low').length;
    if (lowRiskCount === 0) { return; }
    requestDeleteConfirm({
      title: '确认执行低风险修复',
      message: `将执行 ${lowRiskCount} 项低风险画布结构修复：移除悬挂连线、移除节点组缺失成员引用、去重节点组成员。不会执行中风险修复，也不会删除普通数据节点。确认继续？`,
      confirmLabel: '执行低风险修复',
      onConfirm: () => {
        applyLowRiskCanvasHealthRepairs();
        const nextCanvas = useCanvasStore.getState().canvasFile;
        setCanvasHealthReport(buildCanvasHealthReport(nextCanvas));
      },
    });
  }, [applyLowRiskCanvasHealthRepairs, canvasHealthReport, requestDeleteConfirm]);

  useEffect(() => onMessage(msg => {
    if (msg.type === 'conversionDiagnostics') {
      setConversionDiagnostics(msg.report);
      setConversionDiagnosticsLoading(false);
      setConversionDiagnosticsError(null);
    } else if (msg.type === 'conversionDiagnosticsError') {
      setConversionDiagnosticsLoading(false);
      setConversionDiagnosticsError(msg.message || '诊断失败');
    }
  }), []);

  useEffect(() => {
    if (!settingsPanelOpen || !settings) { return; }
    if (firstSettingsSnapshotRef.current) {
      firstSettingsSnapshotRef.current = false;
      setSettingsPersistStatus('saved');
      setSettingsSavedAt(Date.now());
      return;
    }
    setSettingsPersistStatus('saved');
    setSettingsSavedAt(Date.now());
  }, [settings, settingsPanelOpen]);

  // Auto-fetch model lists when panel opens
  useEffect(() => {
    if (!settingsPanelOpen) { return; }
    requestModelCache('copilot');
    if (settings?.anthropicApiKey) {
      requestModelCache('anthropic');
    }
    requestModelCache('ollama');
    requestModelCache('omlx');
    for (const cp of (settings?.customProviders ?? [])) {
      requestModelCache(cp.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsPanelOpen]);

  useEffect(() => {
    if (!settingsPanelOpen) {
      setDetailView(null);
      setFavoriteProviderId(null);
      setLlmTab('overview');
      firstSettingsSnapshotRef.current = true;
    }
  }, [settingsPanelOpen]);

  useEffect(() => {
    if (!settingsPanelOpen || !settingsPanelDetailView) { return; }
    setDetailView(settingsPanelDetailView);
  }, [settingsPanelOpen, settingsPanelDetailView]);

  const customProviders = settings?.customProviders ?? [];
  const providerOptions = buildProviderOptions(customProviders);

  const saveCustomProviders = (list: CustomProviderConfig[]) => {
    saveSetting('customProviders', list);
  };

  const persistenceContextValue = useMemo<SettingsPersistenceContextValue>(() => ({
    status: settingsPersistStatus,
    lastSavedAt: settingsSavedAt,
    saveSetting,
    queueSetting,
    saveNow: saveSettingsNow,
  }), [queueSetting, saveSetting, saveSettingsNow, settingsPersistStatus, settingsSavedAt]);

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

  const renderLlmOverviewTab = () => (
    <>
      <Section title="全局服务商">
        <Field label="全局默认服务商">
          <SearchableSelect
            style={selectStyle}
            value={settings.globalProvider}
            options={providerOptions}
            onChange={v => saveSetting('globalProvider', v)}
            placeholder="搜索服务商..."
          />
        </Field>
        <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
          功能节点可单独覆盖此设置。
        </div>
      </Section>

      <Section title="预算上限">
        <Field label="最大输出 tokens（0 = 自动）">
          <input
            key={`max-output-${settings.maxOutputTokens ?? 0}`}
            style={inputStyle}
            type="number"
            min={0}
            defaultValue={settings.maxOutputTokens ?? 0}
            placeholder="0"
            onBlur={e => saveSetting('maxOutputTokens', Math.max(0, Number(e.target.value) || 0))}
          />
        </Field>
        <Field label="最大上下文 tokens（0 = 自动）">
          <input
            key={`max-context-${settings.maxContextTokens ?? 0}`}
            style={inputStyle}
            type="number"
            min={0}
            defaultValue={settings.maxContextTokens ?? 0}
            placeholder="0"
            onBlur={e => saveSetting('maxContextTokens', Math.max(0, Number(e.target.value) || 0))}
          />
        </Field>
        <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
          规则：<code>0</code> 表示“自动取最大”；当插件已知模型上限时，实际使用 <strong>min(模型最大值, 这里设置的值)</strong>。
        </div>
      </Section>

      <Section title="常用模型说明">
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.6 }}>
          设置页里的“常用模型”管理始终显示完整模型列表；功能节点则优先只显示你勾选并排序后的常用模型，降低切换模型时的噪音。
        </div>
      </Section>
    </>
  );

  const renderLlmBuiltinTab = () => (
    <>
      <Section title="GitHub Copilot">
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
          零配置，需要安装并登录 GitHub Copilot 扩展。
        </div>
        <Field label="默认模型">
          <ModelSelect
            providerId="copilot"
            value={settings.copilotModel}
            onChange={v => saveSetting('copilotModel', v)}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setFavoriteProviderId('copilot')} style={smallBtnStyle}>⭐ 常用模型</button>
        </div>
      </Section>

      <Section title="Anthropic Claude">
        <Field label="API Key">
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              key={settings.anthropicApiKey}
              style={{ ...inputStyle, flex: 1 }}
              type={showAnthropicKey ? 'text' : 'password'}
              defaultValue={settings.anthropicApiKey}
              placeholder="sk-ant-..."
              onChange={e => queueSetting('anthropicApiKey', e.target.value)}
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
            onChange={v => saveSetting('anthropicModel', v)}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setFavoriteProviderId('anthropic')} style={smallBtnStyle}>⭐ 常用模型</button>
        </div>
      </Section>

      <Section title="Ollama（本地）">
        <Field label="Base URL">
          <input
            key={settings.ollamaBaseUrl}
            style={inputStyle}
            defaultValue={settings.ollamaBaseUrl}
            placeholder="http://localhost:11434"
            onBlur={e => saveSetting('ollamaBaseUrl', e.target.value)}
          />
        </Field>
        <Field label="默认模型">
          <ModelSelect
            providerId="ollama"
            value={settings.ollamaModel}
            onChange={v => saveSetting('ollamaModel', v)}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setFavoriteProviderId('ollama')} style={smallBtnStyle}>⭐ 常用模型</button>
        </div>
      </Section>

      <Section title="oMLX（本地）">
        <Field label="Base URL">
          <input
            key={settings.omlxBaseUrl}
            style={inputStyle}
            defaultValue={settings.omlxBaseUrl}
            placeholder="http://localhost:11433/v1"
            onBlur={e => saveSetting('omlxBaseUrl', e.target.value)}
          />
        </Field>
        <Field label="API Key（可选）">
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              key={settings.omlxApiKey}
              style={{ ...inputStyle, flex: 1 }}
              type={showOmlxKey ? 'text' : 'password'}
              defaultValue={settings.omlxApiKey}
              placeholder="未启用鉴权时可留空"
              onChange={e => queueSetting('omlxApiKey', e.target.value)}
            />
            <button onClick={() => setShowOmlxKey(v => !v)} style={smallBtnStyle}>
              {showOmlxKey ? '👁' : '🔒'}
            </button>
          </div>
        </Field>
        <Field label="默认模型">
          <ModelSelect
            providerId="omlx"
            value={settings.omlxModel}
            onChange={v => saveSetting('omlxModel', v)}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setFavoriteProviderId('omlx')} style={smallBtnStyle}>⭐ 常用模型</button>
        </div>
      </Section>
    </>
  );

  const renderLlmCustomTab = () => (
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
            onDelete={() => requestDeleteConfirm({
              title: '确认删除自定义服务商',
              message: `确认删除自定义服务商“${cp.name}”？这会移除它的地址、密钥和默认模型配置。`,
              confirmLabel: '删除服务商',
              onConfirm: () => saveCustomProviders(customProviders.filter(p => p.id !== cp.id)),
            })}
            onManageFavorites={() => setFavoriteProviderId(cp.id)}
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
  );

  const renderMultimodalDetails = () => (
    <Section title="AIHubMix 配置">
      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
        图像生成 / 图像编辑 / TTS / STT / 视频生成等多模态工具专用，与上方 LLM 服务商相互独立。
      </div>
      <Field label="AIHubMix API Key">
        <AiHubMixKeyInput
          value={settings.aiHubMixApiKey ?? ''}
          onChange={v => queueSetting('aiHubMixApiKey', v)}
        />
      </Field>
      <Field label="图像生成默认模型">
        <MultimodalModelSelect
          value={settings.aiHubMixImageGenModel || 'gemini-3-pro-image-preview'}
          options={[
            { value: 'gpt-image-2',                     label: 'GPT Image 2' },
            { value: 'gemini-3-pro-image-preview',     label: 'Gemini 3 Pro Image Preview' },
            { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
            { value: 'doubao-seedream-5.0-lite',       label: 'Doubao Seedream 5.0 Lite' },
          ]}
          onChange={v => saveSetting('aiHubMixImageGenModel', v)}
        />
      </Field>
      <Field label="图像编辑默认模型">
        <MultimodalModelSelect
          value={settings.aiHubMixImageEditModel || 'gemini-3-pro-image-preview'}
          options={[
            { value: 'gpt-image-2',                     label: 'GPT Image 2' },
            { value: 'gemini-3-pro-image-preview',     label: 'Gemini 3 Pro Image Preview' },
            { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
            { value: 'doubao-seedream-5.0-lite',       label: 'Doubao Seedream 5.0 Lite' },
          ]}
          onChange={v => saveSetting('aiHubMixImageEditModel', v)}
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
          onChange={v => saveSetting('aiHubMixImageFusionModel', v)}
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
          onChange={v => saveSetting('aiHubMixImageGroupModel', v)}
        />
      </Field>
      <Field label="TTS 默认模型">
        <MultimodalModelSelect
          value={settings.aiHubMixTtsModel || 'gpt-4o-mini-tts'}
          options={[
            { value: 'gpt-4o-mini-tts', label: 'GPT-4o Mini TTS' },
            { value: 'tts-1',           label: 'tts-1' },
          ]}
          onChange={v => saveSetting('aiHubMixTtsModel', v)}
        />
      </Field>
      <Field label="STT 默认模型">
        <MultimodalModelSelect
          value={settings.aiHubMixSttModel || 'whisper-large-v3-turbo'}
          options={[
            { value: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
            { value: 'whisper-large-v3',       label: 'Whisper Large v3' },
          ]}
          onChange={v => saveSetting('aiHubMixSttModel', v)}
        />
      </Field>
      <Field label="视频生成默认模型">
        <MultimodalModelSelect
          value={settings.aiHubMixVideoGenModel || 'doubao-seedance-2-0-260128'}
          options={[
            { value: 'doubao-seedance-2-0-260128',      label: 'Doubao Seedance 2.0' },
            { value: 'doubao-seedance-2-0-fast-260128', label: 'Doubao Seedance 2.0 Fast' },
          ]}
          onChange={v => saveSetting('aiHubMixVideoGenModel', v)}
        />
      </Field>
    </Section>
  );

  const renderExplosionDetails = () => (
    <Section title="MinerU 文档转换">
      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
        文件转换支持 PDF / Word / PPT / XLS / XLSX / 图片输入：表格文件可在本地转 Markdown / TeX；PDF / Word / PPT 可转 PNG 或继续走 MinerU 拆解为文字 + 图片。Token 仅保存到你本机的 VS Code 设置，不进入源码或发布物。
      </div>
      <div
        style={{
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 8,
          padding: 10,
          background: 'color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-sideBar-background))',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>转换环境诊断</div>
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
              检查 Word / PowerPoint / LibreOffice、PDF 渲染 runtime 和 MinerU 配置，帮助定位文件转换失败原因。
            </div>
          </div>
          <button
            onClick={requestConversionDiagnostics}
            disabled={conversionDiagnosticsLoading}
            style={{
              ...smallBtnStyle,
              padding: '5px 10px',
              opacity: conversionDiagnosticsLoading ? 0.65 : 1,
              cursor: conversionDiagnosticsLoading ? 'wait' : 'pointer',
            }}
          >
            {conversionDiagnosticsLoading ? '检查中…' : '开始检查'}
          </button>
        </div>
        {conversionDiagnosticsError && (
          <div style={{ fontSize: 11, color: 'var(--vscode-errorForeground, #f48771)' }}>
            诊断失败：{conversionDiagnosticsError}
          </div>
        )}
        {conversionDiagnostics && (
          <>
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
              最近检查：{new Date(conversionDiagnostics.checkedAt).toLocaleString()} · 平台：{conversionDiagnostics.platform} ·
              可用 {conversionDiagnostics.summary.ok} / 注意 {conversionDiagnostics.summary.warning} / 不可用 {conversionDiagnostics.summary.error}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {conversionDiagnostics.items.map(result => {
                const color = conversionStatusColor(result.status);
                return (
                  <div
                    key={result.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '20px 1fr',
                      gap: 8,
                      padding: '7px 8px',
                      borderRadius: 6,
                      border: '1px solid color-mix(in srgb, var(--vscode-panel-border) 78%, transparent)',
                      background: 'color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)',
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: `1px solid ${color}`,
                        color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                      title={conversionStatusLabel(result.status)}
                    >
                      {conversionStatusIcon(result.status)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{result.title}</span>
                        <span style={{ fontSize: 10, color }}>{conversionStatusLabel(result.status)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vscode-foreground)', lineHeight: 1.45 }}>
                        {result.summary}
                      </div>
                      {result.detail && (
                        <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45, wordBreak: 'break-word' }}>
                          {result.detail}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <Field label="API 模式">
        <SearchableSelect
          style={selectStyle}
          value={settings.mineruApiMode}
          options={[
            { value: 'precise', label: 'precise（在线精准解析）', keywords: ['precise', 'online', '精准'] },
            { value: 'agent', label: 'agent（轻量接口，待接入）', keywords: ['agent', 'light', '轻量'] },
            { value: 'local', label: 'local（本地 fallback）', keywords: ['local', 'fallback', '本地'] },
          ]}
          onChange={v => saveSetting('mineruApiMode', v)}
          placeholder="选择 MinerU 模式..."
        />
      </Field>
      <Field label="在线 API Base URL">
        <input
          key={settings.mineruApiBaseUrl}
          style={inputStyle}
          defaultValue={settings.mineruApiBaseUrl}
          placeholder="https://mineru.net"
          onBlur={e => saveSetting('mineruApiBaseUrl', e.target.value.trim())}
        />
      </Field>
      <Field label="在线 API Token">
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            key={settings.mineruApiToken}
            style={{ ...inputStyle, flex: 1 }}
            type={showMineruToken ? 'text' : 'password'}
            defaultValue={settings.mineruApiToken}
            placeholder="Bearer Token"
            onChange={e => queueSetting('mineruApiToken', e.target.value)}
          />
          <button onClick={() => setShowMineruToken(v => !v)} style={smallBtnStyle}>
            {showMineruToken ? '👁' : '🔒'}
          </button>
        </div>
      </Field>
      <Field label="模型版本">
        <SearchableSelect
          style={selectStyle}
          value={settings.mineruModelVersion}
          options={[
            { value: 'pipeline', label: 'pipeline', keywords: ['pipeline'] },
            { value: 'vlm', label: 'vlm', keywords: ['vlm'] },
            { value: 'MinerU-HTML', label: 'MinerU-HTML', keywords: ['html', 'mineru-html'] },
          ]}
          onChange={v => saveSetting('mineruModelVersion', v)}
          placeholder="选择模型版本..."
        />
      </Field>
      <Field label="轮询间隔（毫秒）">
        <input
          key={`mineru-poll-interval-${settings.mineruPollIntervalMs}`}
          style={inputStyle}
          type="number"
          min={500}
          defaultValue={settings.mineruPollIntervalMs}
          onBlur={e => saveSetting('mineruPollIntervalMs', Math.max(500, Number(e.target.value) || 2500))}
        />
      </Field>
      <Field label="轮询超时（毫秒）">
        <input
          key={`mineru-poll-timeout-${settings.mineruPollTimeoutMs}`}
          style={inputStyle}
          type="number"
          min={5000}
          defaultValue={settings.mineruPollTimeoutMs}
          onBlur={e => saveSetting('mineruPollTimeoutMs', Math.max(5000, Number(e.target.value) || 300000))}
        />
      </Field>
      <Field label="本地 fallback URL">
        <input
          key={settings.mineruLocalApiUrl}
          style={inputStyle}
          defaultValue={settings.mineruLocalApiUrl}
          placeholder="http://localhost:8000"
          onBlur={e => saveSetting('mineruLocalApiUrl', e.target.value.trim())}
        />
      </Field>
    </Section>
  );

  const renderCanvasDetails = () => (
    <Section title="画布">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
        <input
          type="checkbox"
          checked={settings.autoSave}
          onChange={e => saveSetting('autoSave', e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span>自动保存（每 3 分钟）</span>
      </label>
      <div
        style={{
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 8,
          padding: 10,
          background: 'color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-sideBar-background))',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>画布数据健康检查</div>
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
              只读检查当前画布结构，不会自动删除或修复任何节点、连线、画板、节点组或蓝图数据。
            </div>
          </div>
          <button onClick={runCanvasHealthCheck} style={{ ...smallBtnStyle, padding: '5px 10px' }}>
            开始检查
          </button>
        </div>
        {canvasHealthReport && (
          <>
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              最近检查：{new Date(canvasHealthReport.checkedAt).toLocaleString()} ·
              节点 {canvasHealthReport.stats.nodeCount} / 连线 {canvasHealthReport.stats.edgeCount} / 画板 {canvasHealthReport.stats.boardCount} / 节点组 {canvasHealthReport.stats.nodeGroupCount} / 蓝图 {canvasHealthReport.stats.blueprintNodeCount} / 暂存 {canvasHealthReport.stats.stagingNodeCount}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10 }}>
              {(['error', 'warning', 'info'] as CanvasHealthSeverity[]).map(severity => (
                <span key={severity} style={{ color: canvasHealthSeverityColor(severity) }}>
                  {canvasHealthSeverityLabel(severity)} {canvasHealthReport.summary[severity]}
                </span>
              ))}
            </div>
            {canvasHealthReport.issues.length === 0 ? (
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                color: 'var(--vscode-terminal-ansiGreen)',
                background: 'color-mix(in srgb, var(--vscode-terminal-ansiGreen) 10%, transparent)',
                fontSize: 11,
                lineHeight: 1.5,
              }}>
                未发现结构问题。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {canvasHealthReport.issues.slice(0, 80).map(entry => {
                  const color = canvasHealthSeverityColor(entry.severity);
                  return (
                    <div
                      key={entry.id}
                      style={{
                        padding: '7px 8px',
                        borderRadius: 6,
                        border: '1px solid color-mix(in srgb, var(--vscode-panel-border) 78%, transparent)',
                        background: 'color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{entry.title}</span>
                        <span style={{ fontSize: 10, color }}>{canvasHealthSeverityLabel(entry.severity)}</span>
                        {entry.targetId && (
                          <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>{entry.targetId}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45, wordBreak: 'break-word' }}>
                        {entry.detail}
                      </div>
                    </div>
                  );
                })}
                {canvasHealthReport.issues.length > 80 && (
                  <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                    仅显示前 80 条问题；当前共 {canvasHealthReport.issues.length} 条。
                  </div>
                )}
              </div>
            )}
            {canvasHealthReport.repairPlan.length > 0 && (
              <div
                style={{
                  borderTop: '1px solid var(--vscode-panel-border)',
                  paddingTop: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700 }}>可生成的修复计划（仅预览）</div>
                <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
                  低风险项可在确认后执行；中风险项继续只展示，不会自动修复。
                </div>
                {canvasHealthReport.repairPlan.some(plan => plan.risk === 'low') && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <button
                      onClick={confirmLowRiskCanvasHealthRepair}
                      style={{
                        ...smallBtnStyle,
                        padding: '5px 10px',
                        background: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                      }}
                    >
                      执行低风险修复
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto' }}>
                  {canvasHealthReport.repairPlan.slice(0, 50).map(plan => {
                    const riskColor = plan.risk === 'low'
                      ? 'var(--vscode-terminal-ansiGreen)'
                      : plan.risk === 'medium'
                        ? 'var(--vscode-terminal-ansiYellow)'
                        : 'var(--vscode-errorForeground, #f48771)';
                    const riskLabel = plan.risk === 'low' ? '低风险' : plan.risk === 'medium' ? '中风险' : '高风险';
                    return (
                      <div
                        key={plan.issueId}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          border: '1px solid color-mix(in srgb, var(--vscode-panel-border) 78%, transparent)',
                          background: 'color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{plan.title}</span>
                          <span style={{ fontSize: 10, color: riskColor }}>{riskLabel}</span>
                          {plan.targetId && (
                            <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>{plan.targetId}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45, wordBreak: 'break-word' }}>
                          {plan.action}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );

  return (
    <SettingsPersistenceContext.Provider value={persistenceContextValue}>
    <div style={panelStyle}>
      <PanelHeader onClose={() => setSettingsPanelOpen(false)} />
      <SettingsSaveBar />

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.6 }}>
          主设置保持简洁；详细配置、完整模型列表和常用模型管理已拆到二级弹窗中。
        </div>

        <SettingsEntryCard
          title="LLM 文本服务商"
          description="全局服务商、默认模型、上下文/输出预算、自定义 OpenAI 兼容服务商。"
          summary={`当前全局：${getProviderDisplayName(settings.globalProvider, settings)} · 常用 provider ${3 + customProviders.length} 个`}
          accent="var(--vscode-terminal-ansiBlue)"
          onOpen={() => setDetailView('llm')}
        />
        <SettingsEntryCard
          title="多模态工具"
          description="AIHubMix 的图像、TTS、STT、视频等默认模型。"
          summary={settings.aiHubMixApiKey ? '已配置 AIHubMix Key' : '尚未配置 AIHubMix Key'}
          accent="var(--vscode-terminal-ansiMagenta)"
          onOpen={() => setDetailView('multimodal')}
        />
        <SettingsEntryCard
          title="文档转换（MinerU）"
          description="文件转换中“文字 + 图片拆解”所需的 MinerU 在线 / 本地 fallback 配置与 Token。"
          summary={settings.mineruApiToken ? `模式：${settings.mineruApiMode} · 已配置 Token` : `模式：${settings.mineruApiMode} · 尚未配置 Token`}
          accent="var(--vscode-terminal-ansiYellow)"
          onOpen={() => setDetailView('explosion')}
        />
        <SettingsEntryCard
          title="画布"
          description="自动保存等工作区编辑行为。"
          summary={settings.autoSave ? '自动保存：开启' : '自动保存：关闭'}
          accent="var(--vscode-descriptionForeground)"
          onOpen={() => setDetailView('canvas')}
        />
        <SettingsEntryCard
          title="宠物伴侣"
          description="宠物开关、宠物 AI、主题与成长状态。"
          summary={petEnabled ? `已启用 · ${getPetType(petType).name}` : '当前未启用'}
          accent="var(--vscode-terminal-ansiGreen)"
          onOpen={() => setDetailView('pet')}
        />
      </div>

      {detailView === 'llm' && (
        <SettingsSubModal title="LLM 文本服务商设置" onClose={() => setDetailView(null)}>
          <ModalTabs
            value={llmTab}
            onChange={setLlmTab}
            tabs={[
              { value: 'overview', label: '概览' },
              { value: 'builtin', label: '内置服务商' },
              { value: 'custom', label: '自定义服务商' },
            ]}
          />
          {llmTab === 'overview' && renderLlmOverviewTab()}
          {llmTab === 'builtin' && renderLlmBuiltinTab()}
          {llmTab === 'custom' && renderLlmCustomTab()}
        </SettingsSubModal>
      )}
      {detailView === 'multimodal' && (
        <SettingsSubModal title="多模态工具设置" onClose={() => setDetailView(null)}>
          {renderMultimodalDetails()}
        </SettingsSubModal>
      )}
      {detailView === 'explosion' && (
        <SettingsSubModal title="文档转换设置" onClose={() => setDetailView(null)}>
          {renderExplosionDetails()}
        </SettingsSubModal>
      )}
      {detailView === 'canvas' && (
        <SettingsSubModal title="画布设置" onClose={() => setDetailView(null)}>
          {renderCanvasDetails()}
        </SettingsSubModal>
      )}
      {detailView === 'pet' && (
        <SettingsSubModal title="宠物伴侣设置" onClose={() => setDetailView(null)}>
          <PetSettingsSection />
        </SettingsSubModal>
      )}
      {favoriteProviderId && (
        <FavoriteModelsModal
          providerId={favoriteProviderId}
          settings={settings}
          onClose={() => setFavoriteProviderId(null)}
        />
      )}
    </div>
    </SettingsPersistenceContext.Provider>
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

const modalBackdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
  padding: 16,
};

const modalPanelStyle: React.CSSProperties = {
  width: 'min(760px, calc(100vw - 48px))',
  maxHeight: 'calc(100vh - 48px)',
  background: 'var(--vscode-sideBar-background)',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 10,
  boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
  overflow: 'hidden',
};

// ── PetSettingsSection ───────────────────────────────────────────────────────

function PetSettingsSection() {
  const {
    enabled,
    setEnabled,
    pet,
    setPetType,
    setPetName,
    restReminderMin,
    setRestReminderMin,
    groundTheme,
    setGroundTheme,
    suggestionActivity,
    setSuggestionActivity,
    displayMode,
    setDisplayMode,
    longTermMemory,
    setLongTermMemory,
    clearLongTermMemory,
    memorySummary,
    requestMemorySummary,
  } = usePetStore();
  const settings = useCanvasStore(s => s.settings);
  const modelCache = useCanvasStore(s => s.modelCache);
  const { saveSetting } = useSettingsPersistence();
  const [nameInput, setNameInput] = useState(pet.petName);
  const nameTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setNameInput(pet.petName);
  }, [pet.petName]);

  useEffect(() => {
    if (enabled && longTermMemory) {
      requestMemorySummary();
    }
  }, [enabled, longTermMemory, requestMemorySummary]);

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
  const petExpProgress = getPetLevelProgress(pet.exp, pet.level);
  const petGrowth = getPetGrowthSummary(pet);

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

          <Section title="显示模式">
            <SearchableSelect
              style={selectStyle}
              value={displayMode}
              options={[
                { value: 'panel', label: '固定小面板', keywords: ['panel', '面板', '固定'] },
                { value: 'canvas-follow', label: '全画布跟随', keywords: ['canvas', 'follow', '画布', '跟随'] },
              ]}
              onChange={v => setDisplayMode(v as PetDisplayMode)}
              placeholder="选择显示模式..."
            />
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              全画布跟随会把宠物作为画布内轻量悬浮角色，聊天和小游戏仍使用固定面板。
            </div>
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

          <Section title="主动建议">
            <SearchableSelect
              style={selectStyle}
              value={suggestionActivity}
              options={[
                { value: 'off', label: '勿扰：不主动气泡提醒', keywords: ['off', '勿扰', '关闭'] },
                { value: 'quiet', label: '安静：只保留重要提醒', keywords: ['quiet', '安静'] },
                { value: 'balanced', label: '平衡：低频上下文建议', keywords: ['balanced', '平衡'] },
                { value: 'active', label: '活跃：更快给出整理建议', keywords: ['active', '活跃'] },
              ]}
              onChange={v => setSuggestionActivity(v as PetSuggestionActivity)}
              placeholder="选择活跃度..."
            />
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              该设置只影响宠物主动提醒，不影响点击、对话和休息统计。
            </div>
          </Section>

          <Section title="长期记忆">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={longTermMemory}
                onChange={e => setLongTermMemory(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>启用本地长期记忆</span>
            </label>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              只保存宠物状态、近期事件类型和会话摘要，不保存源文件正文。
            </div>
            {longTermMemory && (
              <div style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                border: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editorWidget-background, rgba(255,255,255,0.04))',
                fontSize: 11,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>我学到了</div>
                {memorySummary ? (
                  <>
                    <div>主动建议：{formatPetSuggestionActivity(memorySummary.profile.suggestionActivity)}</div>
                    <div>显示偏好：{memorySummary.profile.displayMode === 'canvas-follow' ? '全画布跟随' : '固定小面板'}</div>
                    <div>
                      常用场景：{memorySummary.profile.frequentScenes.length > 0
                        ? memorySummary.profile.frequentScenes.map(formatPetScene).join('、')
                        : '暂无'}
                    </div>
                    <div>
                      常用节点：{memorySummary.profile.frequentNodeTypes.length > 0
                        ? memorySummary.profile.frequentNodeTypes.map(formatPetNodeType).join('、')
                        : '暂无'}
                    </div>
                    <div>
                      常用工具：{memorySummary.profile.frequentTools.length > 0
                        ? memorySummary.profile.frequentTools.slice(-4).join('、')
                        : '暂无'}
                    </div>
                    <div>
                      近期事件：{memorySummary.profile.frequentEventTypes.length > 0
                        ? memorySummary.profile.frequentEventTypes.map(formatPetEventType).join('、')
                        : '暂无'}
                    </div>
                    <div>
                      建议响应：展示 {memorySummary.profile.suggestionStats.shown} 次，采纳 {memorySummary.profile.suggestionStats.accepted} 次，稍后 {memorySummary.profile.suggestionStats.later} 次，屏蔽 {memorySummary.profile.suggestionStats.muted} 次
                      {memorySummary.profile.suggestionStats.shown > 0
                        ? `，采纳率 ${Math.round((memorySummary.profile.suggestionStats.accepted / memorySummary.profile.suggestionStats.shown) * 100)}%`
                        : ''}
                    </div>
                    <div style={{ marginTop: 4, color: 'var(--vscode-descriptionForeground)' }}>
                      最近记忆：{memorySummary.records[0]?.text ?? '暂无会话摘要'}
                    </div>
                  </>
                ) : (
                  <span style={{ color: 'var(--vscode-descriptionForeground)' }}>暂无长期记忆摘要。</span>
                )}
              </div>
            )}
            <button
              onClick={() => {
                const ok = window.confirm('确定清空宠物长期记忆吗？这会删除 pet/profile.json、pet/memory.jsonl 和 pet/memory.md，但不会删除宠物等级和位置状态。');
                if (ok) { clearLongTermMemory(); }
              }}
              style={{
                marginTop: 8,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--vscode-inputValidation-warningBorder, #cca700)',
                background: 'transparent',
                color: 'var(--vscode-foreground)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              清空长期记忆
            </button>
            <button
              onClick={() => requestMemorySummary()}
              disabled={!longTermMemory}
              style={{
                marginTop: 8,
                marginLeft: 8,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--vscode-button-border, var(--vscode-panel-border))',
                background: 'transparent',
                color: longTermMemory ? 'var(--vscode-foreground)' : 'var(--vscode-disabledForeground)',
                cursor: longTermMemory ? 'pointer' : 'default',
                fontSize: 11,
              }}
            >
              刷新记忆摘要
            </button>
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
                onChange={v => saveSetting('petAiProvider', v)}
                placeholder="搜索服务商..."
              />
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={labelStyle}>AI 模型</div>
              <ModelSelect
                providerId={resolvedPetProvider}
                value={settings?.petAiModel ?? ''}
                onChange={v => saveSetting('petAiModel', v)}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              宠物对话使用独立的服务商和模型，可选择轻量模型节省开销。
            </div>
          </Section>

          <Section title="宠物状态">
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>
                等级: Lv.{pet.level}
                {petExpProgress.isMaxLevel
                  ? ' | 已满级'
                  : ` | 本级经验: ${Math.floor(petExpProgress.currentLevelExp)}/${petExpProgress.neededExpInLevel} | 距下一级: ${Math.ceil(petExpProgress.remainingToNextLevel)}`}
              </span>
              <div
                title={
                  petExpProgress.isMaxLevel
                    ? `总经验: ${Math.floor(petExpProgress.totalExp)} / MAX`
                    : `升级进度 ${petExpProgress.percent.toFixed(1)}%`
                }
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--vscode-editorWidget-background, rgba(255,255,255,0.08))',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  width: `${petExpProgress.percent}%`,
                  height: '100%',
                  background: 'var(--vscode-progressBar-background, var(--vscode-button-background))',
                  transition: 'width 0.35s ease',
                }} />
              </div>
              <span>心情: {Math.round(pet.mood)} | 精力: {Math.round(pet.energy)}</span>
              <span>已解锁宠物: {pet.unlockedPets.length}/{PET_TYPES.length}</span>
              <span>总工作时间: {Math.floor(pet.totalWorkMinutes)} 分钟</span>
            </div>
          </Section>

          <Section title="成长与进化">
            <div style={{
              padding: 8,
              borderRadius: 8,
              border: '1px solid var(--vscode-panel-border)',
              background: 'var(--vscode-editorWidget-background, rgba(255,255,255,0.04))',
              fontSize: 11,
              lineHeight: 1.5,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--vscode-foreground)' }}>{petGrowth.stageLabel}</div>
                  <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {petGrowth.isMaxLevel
                      ? '当前已达到最高成长阶段。'
                      : `距下一等级还需 ${Math.ceil(petGrowth.remainingToNextLevel)} 经验`}
                  </div>
                </div>
                <div style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: '1px solid var(--vscode-panel-border)',
                  color: 'var(--vscode-foreground)',
                  whiteSpace: 'nowrap',
                }}>
                  Lv.{pet.level}
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 4, color: 'var(--vscode-descriptionForeground)' }}>
                  已获得能力 / 伙伴
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {petGrowth.unlockedMilestones.slice(-8).map(milestone => (
                    <span
                      key={milestone.id}
                      title={milestone.description}
                      style={petMilestonePillStyle}
                    >
                      {formatPetMilestoneKind(milestone.kind)} {milestone.title}
                    </span>
                  ))}
                </div>
              </div>

              {petGrowth.nextMilestone && (
                <div style={{ marginTop: 8, color: 'var(--vscode-descriptionForeground)' }}>
                  下一成长：Lv.{petGrowth.nextMilestone.level} · {petGrowth.nextMilestone.title} — {petGrowth.nextMilestone.description}
                </div>
              )}

              <div style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                background: 'rgba(127,127,127,0.08)',
              }}>
                <div style={{ fontWeight: 700, color: 'var(--vscode-foreground)' }}>
                  工作节奏：{petGrowth.workRhythm.rhythmLabel}
                </div>
                <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
                  本次约 {petGrowth.workRhythm.currentSessionMinutes} 分钟；累计约 {petGrowth.workRhythm.totalWorkHours} 小时 {petGrowth.workRhythm.totalWorkMinutes % 60} 分钟。
                </div>
                <div style={{ marginTop: 3, color: 'var(--vscode-descriptionForeground)' }}>
                  {petGrowth.workRhythm.rhythmHint}
                </div>
              </div>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

const petMilestonePillStyle: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 999,
  border: '1px solid var(--vscode-panel-border)',
  background: 'rgba(127,127,127,0.08)',
  color: 'var(--vscode-foreground)',
  fontSize: 10,
};

function formatPetMilestoneKind(kind: PetGrowthMilestoneKind): string {
  if (kind === 'pet') { return '伙伴'; }
  if (kind === 'memory') { return '记忆'; }
  if (kind === 'suggestion') { return '建议'; }
  if (kind === 'awareness') { return '感知'; }
  return '陪伴';
}

function formatPetSuggestionActivity(value: string): string {
  if (value === 'off') { return '勿扰'; }
  if (value === 'quiet') { return '安静'; }
  if (value === 'active') { return '活跃'; }
  return '平衡';
}

function formatPetEventType(value: string): string {
  const map: Record<string, string> = {
    node_added: '新增节点',
    node_deleted: '删除节点',
    node_selected: '选中节点',
    node_connected: '连接节点',
    tool_run_completed: 'AI 完成',
    tool_run_failed: 'AI 失败',
    repeated_error: '连续错误',
    long_session: '长时间工作',
  };
  return map[value] ?? value;
}

function formatPetNodeType(value: string): string {
  const map: Record<string, string> = {
    paper: '论文',
    note: '笔记',
    code: '代码',
    image: '图片',
    ai_output: 'AI 输出',
    audio: '音频',
    video: '视频',
    experiment_log: '实验记录',
    task: '任务',
    data: '数据',
    mindmap: '导图',
    function: 'AI 工具',
    group_hub: '节点组',
    blueprint: '蓝图',
  };
  return map[value] ?? value;
}

function formatPetScene(value: string): string {
  const map: Record<string, string> = {
    paper: '论文',
    proposal: '项目书',
    patent: '专利',
    mixed: '混合',
  };
  return map[value] ?? value;
}
