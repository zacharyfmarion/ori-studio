import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  type OristudioCpToolOptions,
} from '../../lib/oristudioCpToolSettings';
import { CpContextToolReset } from './CpContextToolReset';

describe('CpContextToolReset', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (options: OristudioCpToolOptions, groups: string[]) => {
    act(() => {
      root.render(
        <CpContextToolReset options={options} setOptions={() => {}} groups={groups as never} />,
      );
    });
    return host.querySelector('.cp-context-panel__reset');
  };

  it('stays hidden while every visible setting is at its default', () => {
    // The absence is the point: an untouched tool should look untouched.
    expect(render(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, ['angle-system'])).toBeNull();
  });

  it('appears once a visible setting is off its default', () => {
    const options = { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, angleSystemDivider: 16 };
    expect(render(options, ['angle-system'])).not.toBeNull();
  });

  it('ignores a non-default setting that is not on screen', () => {
    // Scoped to the groups shown, so another tool's setting cannot make this
    // tool look modified.
    const options = { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, polygonCorners: 9 };
    expect(render(options, ['angle-system'])).toBeNull();
    expect(render(options, ['polygon-corners'])).not.toBeNull();
  });

  it('puts the visible settings back, and only those', () => {
    let options: OristudioCpToolOptions = {
      ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
      angleSystemDivider: 16,
      polygonCorners: 9,
    };
    act(() => {
      root.render(
        <CpContextToolReset
          options={options}
          setOptions={(update) => {
            options = typeof update === 'function' ? update(options) : update;
          }}
          groups={['angle-system'] as never}
        />,
      );
    });
    act(() => {
      host.querySelector<HTMLButtonElement>('.cp-context-panel__reset')?.click();
    });
    expect(options.angleSystemDivider).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.angleSystemDivider);
    expect(options.polygonCorners).toBe(9);
  });
});
