import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  title?: string;
  keywords?: string[];
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  style?: React.CSSProperties;
  menuMaxHeight?: number;
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = '搜索...',
  disabled = false,
  compact = false,
  style,
  menuMaxHeight = 220,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedOption = useMemo(
    () => options.find(option => option.value === value) ?? null,
    [options, value]
  );

  const [open, setOpen] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open && searchMode) { return; }
    setQuery(selectedOption?.label ?? '');
  }, [open, searchMode, selectedOption]);

  useEffect(() => {
    if (!open) { return; }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearchMode(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!searchMode) { return options; }
    const needle = query.trim().toLowerCase();
    if (!needle) { return options; }
    return options.filter(option => {
      const haystacks = [option.label, option.title ?? '', ...(option.keywords ?? [])];
      return haystacks.some(text => text.toLowerCase().includes(needle));
    });
  }, [options, query, searchMode]);

  const controlStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    minWidth: 0,
    border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
    borderRadius: 4,
    background: 'var(--vscode-dropdown-background, var(--vscode-input-background))',
    color: 'var(--vscode-dropdown-foreground, var(--vscode-input-foreground))',
    overflow: 'hidden',
    ...style,
  };

  const fontSize = compact ? 11 : 12;
  const paddingY = compact ? 2 : 4;
  const paddingX = compact ? 6 : 8;

  const handleChoose = (optionValue: string) => {
    onChange(optionValue);
    setOpen(false);
    setSearchMode(false);
  };

  return (
    <div ref={rootRef} className="nodrag" style={{ position: 'relative', minWidth: 0 }}>
      <div style={controlStyle}>
        <input
          ref={inputRef}
          type="text"
          value={open && searchMode ? query : (selectedOption?.label ?? '')}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (disabled) { return; }
            setOpen(true);
            setSearchMode(true);
            setQuery('');
          }}
          onChange={event => {
            if (!open) { setOpen(true); }
            if (!searchMode) { setSearchMode(true); }
            setQuery(event.target.value);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            fontSize,
            padding: `${paddingY}px ${paddingX}px`,
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            if (disabled) { return; }
            const nextOpen = !open;
            setOpen(nextOpen);
            setSearchMode(false);
            setQuery(selectedOption?.label ?? '');
            if (nextOpen) {
              inputRef.current?.focus();
            }
          }}
          style={{
            width: compact ? 26 : 30,
            border: 'none',
            borderLeft: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            background: 'transparent',
            color: 'var(--vscode-descriptionForeground)',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: compact ? 10 : 11,
            flexShrink: 0,
          }}
          title="展开完整列表"
        >
          ▼
        </button>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 80,
            maxHeight: menuMaxHeight,
            overflowY: 'auto',
            background: 'var(--vscode-dropdown-listBackground, var(--vscode-editor-background))',
            border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          }}
        >
          {filteredOptions.length === 0 ? (
            <div
              style={{
                padding: compact ? '6px 8px' : '8px 10px',
                fontSize,
                color: 'var(--vscode-descriptionForeground)',
              }}
            >
              未找到匹配项
            </div>
          ) : (
            filteredOptions.map(option => {
              const active = option.value === value;
              return (
                <button
                  key={option.value || '__empty__'}
                  type="button"
                  disabled={option.disabled}
                  title={option.title}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => handleChoose(option.value)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    background: active
                      ? 'var(--vscode-list-activeSelectionBackground, var(--vscode-button-secondaryBackground))'
                      : 'transparent',
                    color: active
                      ? 'var(--vscode-list-activeSelectionForeground, var(--vscode-foreground))'
                      : 'var(--vscode-foreground)',
                    cursor: option.disabled ? 'default' : 'pointer',
                    padding: compact ? '6px 8px' : '8px 10px',
                    fontSize,
                    opacity: option.disabled ? 0.5 : 1,
                  }}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

