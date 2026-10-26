import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Input, InputActionDef, TouchConfig, TouchLayout, TouchButtonDef, Vector2Composite, AxisComposite } from '../../engine/input/InputActions'
import { withMissingDefaults, normalizeTouchConfig, resolveTouchLayout } from '../../engine/input/normalizeActions'
import { DEVICE_PRESETS, buttonRect, findLayoutIssues, joystickRestRect, landscape, touchScale } from '../../engine/input/touchLayoutMath'
import { BUILTIN_ICONS, builtinIconSvg } from '../../player/touchIcons'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'memory-only' | 'error'

const SOURCE_GROUPS: { label: string; items: string[] }[] = [
  {
    label: 'Gamepad',
    items: [
      'Gamepad/LeftStick',
      'Gamepad/RightStick',
      'Gamepad/ButtonSouth',
      'Gamepad/ButtonEast',
      'Gamepad/ButtonWest',
      'Gamepad/ButtonNorth',
      'Gamepad/LeftShoulder',
      'Gamepad/RightShoulder',
      'Gamepad/LeftTrigger',
      'Gamepad/RightTrigger',
      'Gamepad/LeftStickPress',
      'Gamepad/RightStickPress',
      'Gamepad/Start',
      'Gamepad/Select',
      'Gamepad/DPadUp',
      'Gamepad/DPadDown',
      'Gamepad/DPadLeft',
      'Gamepad/DPadRight',
    ],
  },
  { label: 'Sentuh', items: ['Touch/Joystick', 'Touch/Look'] },
  { label: 'Mouse', items: ['Mouse/LeftButton', 'Mouse/RightButton', 'Mouse/MiddleButton', 'Mouse/Delta'] },
]

const ICON_OPTIONS = ['', 'jump', 'attack', 'run', 'use', 'crouch', 'turn-left', 'turn-right', 'up', 'down']
const ANCHORS: NonNullable<TouchButtonDef['anchor']>[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left']

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** Pretty label for a binding id */
function bindingLabel(b: string): string {
  return b.replace(/^Keyboard\/Key([A-Z])$/, '$1').replace(/^Keyboard\/Digit(\d)$/, '$1').replace(/^Keyboard\//, '')
}

const Chip: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-200 bg-black/40 border border-gray-700 rounded px-1.5 py-0.5">
    {label}
    <button className="text-gray-500 hover:text-red-400" onClick={onRemove} title="Hapus">
      ✕
    </button>
  </span>
)

export const InputActionsWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { projectSettings, saveInputSettings, projectPath, touchLoadReport } = useEditorStore()
  const [actions, setActions] = useState<InputActionDef[]>(() => clone(projectSettings.inputActions || []))
  const [touch, setTouch] = useState<TouchConfig>(() => clone(projectSettings.touch))
  const [tab, setTab] = useState<'actions' | 'touch'>('actions')
  const [selected, setSelected] = useState(0)
  const [listening, setListening] = useState<string | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ actions, touch })
  latest.current = { actions, touch }

  const action = actions[selected]

  const persist = (nextActions: InputActionDef[], nextTouch: TouchConfig) => {
    setActions(nextActions)
    setTouch(nextTouch)
    setStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setStatus(await saveInputSettings(latest.current.actions, latest.current.touch))
    }, 500)
  }
  const updateActions = (fn: (draft: InputActionDef[]) => void) => {
    const next = clone(actions)
    fn(next)
    persist(next, touch)
  }
  const updateTouch = (fn: (draft: TouchConfig) => void) => {
    const next = clone(touch)
    fn(next)
    persist(actions, next)
  }

  // Flush a pending save when the window closes
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        void saveInputSettings(latest.current.actions, latest.current.touch)
      }
      Input.cancelListen()
    },
    [saveInputSettings]
  )

  /** Capture the next key/mouse button; Escape cancels */
  const listen = (slot: string, onBinding: (binding: string) => void) => {
    setListening(slot)
    Input.listenNextInput((binding) => {
      setListening(null)
      if (binding !== 'Keyboard/Escape') onBinding(binding)
    })
  }

  const addToList = (list: string[] | undefined, binding: string) => {
    const out = list ? [...list] : []
    if (!out.includes(binding)) out.push(binding)
    return out
  }


  const SourcePicker: React.FC<{ onPick: (b: string) => void }> = ({ onPick }) => (
    <select
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-[11px]"
      title="Tambah sumber gamepad / sentuh / mouse"
    >
      <option value="">+ Sumber…</option>
      {SOURCE_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((it) => (
            <option key={it} value={it}>
              {it}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  /** One slot (e.g. composite.up) as chips + Listen + source picker */
  const BindingList: React.FC<{ slotId: string; list: string[] | undefined; onChange: (list: string[]) => void }> = ({ slotId, list, onChange }) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {(list ?? []).map((b, i) => (
        <Chip key={b} label={bindingLabel(b)} onRemove={() => onChange((list ?? []).filter((_, j) => j !== i))} />
      ))}
      <button
        className={`px-2 py-0.5 rounded text-white text-[11px] ${listening === slotId ? 'bg-amber-600 animate-pulse' : 'bg-blue-700 hover:bg-blue-600'}`}
        onClick={() => listen(slotId, (b) => onChange(addToList(list, b)))}
        title="Tekan tombol keyboard / mouse (Esc batal)"
      >
        {listening === slotId ? 'Tekan tombol…' : '+ Listen'}
      </button>
      <SourcePicker onPick={(b) => onChange(addToList(list, b))} />
    </div>
  )

  const statusText: Record<SaveStatus, string> = {
    idle: projectPath ? 'Tersimpan di project.linden.json' : 'Belum ada proyek: perubahan hanya di memori',
    saving: 'Menyimpan…',
    saved: 'Tersimpan',
    'memory-only': 'Belum ada proyek: perubahan hanya di memori',
    error: 'Gagal menyimpan ke project.linden.json',
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-6 select-none">
      <div
        className={`bg-[#16213e] border border-gray-700/80 rounded-xl shadow-2xl w-full ${tab === 'touch' ? 'max-w-7xl h-[720px]' : 'max-w-4xl h-[600px]'} flex flex-col overflow-hidden text-xs text-gray-200`}
      >
        {/* Title bar */}
        <div className="h-9 px-4 bg-[#0f172a] border-b border-gray-700/60 flex items-center justify-between">
          <span className="font-semibold text-gray-100 flex items-center gap-2">
            <span>🎮</span> Input Actions
          </span>
          <div className="flex items-center gap-1">
            {(['actions', 'touch'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/10'}`}
              >
                {t === 'actions' ? 'Actions' : 'Kontrol Sentuh'}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {tab === 'actions' ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Actions list */}
            <div className="w-56 border-r border-gray-700/50 bg-[#121b33] p-2.5 flex flex-col">
              <div className="flex items-center justify-between mb-2 gap-1">
                <span className="font-semibold text-gray-400 uppercase text-[10px]">Actions</span>
                <div className="flex gap-1">
                  <button
                    className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded text-gray-200 text-[11px]"
                    title="Tambahkan action default yang belum ada (Move, Turn, Vertical, Look, Jump, Sprint, Crouch, Interact, Attack)"
                    onClick={() => persist(withMissingDefaults(actions), touch)}
                  >
                    Default
                  </button>
                  <button
                    className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-white text-[11px]"
                    onClick={() => {
                      let n = actions.length + 1
                      while (actions.some((a) => a.name === `Action_${n}`)) n++
                      updateActions((d) => d.push({ name: `Action_${n}`, type: 'button', bindings: [] }))
                      setSelected(actions.length)
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {actions.map((act, i) => (
                  <div
                    key={`${act.name}-${i}`}
                    onClick={() => setSelected(i)}
                    className={`px-2.5 py-1.5 rounded cursor-pointer flex items-center justify-between ${
                      selected === i ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white/5 text-gray-300'
                    }`}
                  >
                    <span className="truncate">{act.name}</span>
                    <span className="text-[10px] text-gray-400 capitalize">{act.type}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Action configuration */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {action ? (
                <>
                  <div className="space-y-2.5 bg-[#121b33] p-3 rounded-lg border border-gray-700/40">
                    <div className="flex items-center gap-3">
                      <span className="w-24 text-gray-400">Name</span>
                      <input
                        type="text"
                        value={action.name}
                        onChange={(e) => {
                          // Renaming an action keeps every touch button that triggers it connected
                          const oldName = actions[selected].name
                          const newName = e.target.value
                          const nextActions = clone(actions)
                          nextActions[selected].name = newName
                          const nextTouch = clone(touch)
                          const lists = [nextTouch.buttons, ...Object.values(nextTouch.layouts ?? {}).map((l) => l.buttons ?? [])]
                          for (const list of lists) for (const b of list) if (b.action === oldName) b.action = newName
                          persist(nextActions, nextTouch)
                        }}
                        className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                      />
                      <button
                        className="px-2 py-1 text-red-400 hover:text-red-300"
                        onClick={() => {
                          updateActions((d) => d.splice(selected, 1))
                          setSelected(Math.max(0, selected - 1))
                        }}
                        title="Hapus action"
                      >
                        Hapus
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-24 text-gray-400">Type</span>
                      <select
                        value={action.type}
                        onChange={(e) =>
                          updateActions((d) => {
                            d[selected].type = e.target.value as InputActionDef['type']
                            delete d[selected].composites
                          })
                        }
                        className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                      >
                        <option value="button">Button</option>
                        <option value="axis">Axis (−1..1, mis. Q/E)</option>
                        <option value="vector2">Vector2 (mis. WASD / joystick)</option>
                      </select>
                    </div>
                    {action.type !== 'button' && (
                      <div className="flex items-center gap-3">
                        <span className="w-24 text-gray-400">Deadzone</span>
                        <input
                          type="number"
                          step={0.05}
                          min={0}
                          max={0.95}
                          value={action.deadzone ?? 0}
                          onChange={(e) => updateActions((d) => (d[selected].deadzone = parseFloat(e.target.value) || 0))}
                          className="w-24 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                        />
                        {action.type === 'vector2' && (
                          <>
                            <span className="text-gray-400 ml-3">Sensitivity</span>
                            <input
                              type="number"
                              step={0.1}
                              min={0}
                              value={action.sensitivity ?? 1}
                              onChange={(e) => updateActions((d) => (d[selected].sensitivity = parseFloat(e.target.value) || 0))}
                              className="w-20 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                              title="Pengali untuk Mouse/Delta dan Touch/Look"
                            />
                          </>
                        )}
                      </div>
                    )}
                    {action.type === 'button' && (
                      <div className="flex items-center gap-3">
                        <span className="w-24 text-gray-400">Press at</span>
                        <input
                          type="number"
                          step={0.05}
                          min={0.05}
                          max={1}
                          value={action.pressThreshold ?? 0.5}
                          onChange={(e) => updateActions((d) => (d[selected].pressThreshold = parseFloat(e.target.value) || 0.5))}
                          className="w-24 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                          title="Untuk sumber analog (trigger, joystick): aktif saat nilainya mencapai angka ini"
                        />
                      </div>
                    )}
                  </div>

                  {/* Composites */}
                  {action.type !== 'button' && (
                    <div className="space-y-2 bg-[#121b33] p-3 rounded-lg border border-gray-700/40">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-400 uppercase text-[10px]">
                          {action.type === 'vector2' ? 'Tombol arah (mis. WASD dan panah)' : 'Tombol negatif / positif (mis. Q / E)'}
                        </span>
                        <button
                          className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px]"
                          onClick={() => updateActions((d) => (d[selected].composites = [...(d[selected].composites ?? []), {}]))}
                        >
                          + Set
                        </button>
                      </div>
                      {(action.composites ?? []).map((comp, ci) => {
                        const slots = action.type === 'vector2' ? (['up', 'down', 'left', 'right'] as const) : (['negative', 'positive'] as const)
                        return (
                          <div key={ci} className="border border-gray-700/50 rounded p-2 space-y-1.5">
                            <div className="flex justify-between text-[10px] text-gray-500">
                              <span>Set {ci + 1}</span>
                              <button className="hover:text-red-400" onClick={() => updateActions((d) => d[selected].composites!.splice(ci, 1))}>
                                Hapus set
                              </button>
                            </div>
                            {slots.map((slot) => (
                              <div key={slot} className="flex items-start gap-3">
                                <span className="w-16 pt-0.5 capitalize text-gray-400">{slot}</span>
                                <BindingList
                                  slotId={`${selected}:c${ci}:${slot}`}
                                  list={(comp as Record<string, string[] | undefined>)[slot]}
                                  onChange={(list) =>
                                    updateActions((d) => {
                                      ;((d[selected].composites![ci] as Vector2Composite & AxisComposite) as Record<string, string[]>)[slot] = list
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Direct bindings */}
                  <div className="space-y-2 bg-[#121b33] p-3 rounded-lg border border-gray-700/40">
                    <span className="font-semibold text-gray-400 uppercase text-[10px]">
                      {action.type === 'button' ? 'Bindings' : 'Sumber analog (stik, joystick sentuh, mouse)'}
                    </span>
                    <BindingList
                      slotId={`${selected}:bindings`}
                      list={action.bindings}
                      onChange={(list) => updateActions((d) => (d[selected].bindings = list))}
                    />
                  </div>
                </>
              ) : (
                <div className="text-gray-500 text-center py-10">Pilih action di kiri</div>
              )}
            </div>
          </div>
        ) : (
          <TouchLayoutEditor touch={touch} actions={actions} update={updateTouch} report={touchLoadReport} />
        )}

        {/* Footer */}
        <div className="h-10 px-4 bg-[#0f172a] border-t border-gray-700/60 flex items-center justify-between">
          <span className={`text-[11px] ${status === 'error' ? 'text-red-400' : 'text-gray-500'}`} data-testid="input-save-status">
            {statusText[status]}
          </span>
          <button onClick={onClose} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------------------------
// Kontrol Sentuh: layouts, buttons connected to actions, device preview, validation
// ---------------------------------------------------------------------------------------------

const BUTTON_DEFAULTS: Record<string, Partial<TouchButtonDef>> = {
  Jump: { label: 'JUMP', icon: 'jump', behavior: 'hold' },
  Attack: { label: 'HIT', icon: 'attack', behavior: 'tap' },
  Sprint: { label: 'RUN', icon: 'run', behavior: 'hold' },
  Interact: { label: 'USE', icon: 'use', behavior: 'tap' },
  Crouch: { label: 'CROUCH', icon: 'crouch', behavior: 'toggle' },
  Turn: { label: 'E', icon: 'turn-right', behavior: 'hold' },
  Vertical: { label: 'UP', icon: 'up', behavior: 'hold' },
}

const ANCHOR_OPTIONS: NonNullable<TouchButtonDef['anchor']>[] = ['bottom-right', 'bottom-left', 'bottom-center', 'top-right', 'top-left', 'top-center']
const BEHAVIORS: { id: NonNullable<TouchButtonDef['behavior']>; label: string }[] = [
  { id: 'hold', label: 'Hold — aktif selama ditahan' },
  { id: 'tap', label: 'Tap — sekali per ketukan' },
  { id: 'toggle', label: 'Toggle — tekan untuk nyala/mati' },
  { id: 'repeat', label: 'Repeat — berulang selama ditahan' },
]

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="flex items-center gap-2 w-full min-w-0" title={hint}>
    <span className="w-24 shrink-0 text-gray-400">{label}</span>
    {children}
  </label>
)
const inputCls = 'bg-black/40 border border-gray-700 rounded px-2 py-1 text-gray-200 min-w-0'

const TouchLayoutEditor: React.FC<{
  touch: TouchConfig
  actions: InputActionDef[]
  update: (fn: (d: TouchConfig) => void) => void
  report: { migrated: number; warnings: string[] } | null
}> = ({ touch, actions, update, report }) => {
  const [layoutName, setLayoutName] = useState('default')
  const [selectedId, setSelectedId] = useState<string | null>(touch.buttons[0]?.id ?? null)
  const [deviceId, setDeviceId] = useState(DEVICE_PRESETS[1].id)
  const [isLandscape, setIsLandscape] = useState(true)
  const [showReport, setShowReport] = useState(!!report && (report.migrated > 0 || report.warnings.length > 0))

  const layoutNames = ['default', ...Object.keys(touch.layouts ?? {})]
  const isDefault = layoutName === 'default'
  const layoutOverride = isDefault ? undefined : touch.layouts?.[layoutName]
  const inheritsButtons = !isDefault && !layoutOverride?.buttons
  const resolved = useMemo(() => resolveTouchLayout(touch, layoutName), [touch, layoutName])
  const buttons = resolved.buttons
  const selected = buttons.find((b) => b.id === selectedId) ?? null
  const actionTypes = useMemo(() => Object.fromEntries(actions.map((a) => [a.name, a.type])), [actions])
  const usableActions = actions.filter((a) => a.type !== 'vector2')

  /** Editable button list of the current layout (copies the default list on first edit of a layout) */
  const editButtons = (d: TouchConfig): TouchButtonDef[] => {
    if (isDefault) return d.buttons
    d.layouts = d.layouts ?? {}
    const l = (d.layouts[layoutName] = d.layouts[layoutName] ?? {})
    if (!l.buttons) l.buttons = JSON.parse(JSON.stringify(d.buttons))
    return l.buttons!
  }
  const updateButton = (id: string, fn: (b: TouchButtonDef) => void) =>
    update((d) => {
      const b = editButtons(d).find((x) => x.id === id)
      if (b) fn(b)
    })
  /** Layout-level fields: the default config, or the named layout's override */
  const updateLayoutField = (fn: (target: Partial<TouchLayout>) => void) =>
    update((d) => {
      if (isDefault) fn(d)
      else {
        d.layouts = d.layouts ?? {}
        fn((d.layouts[layoutName] = d.layouts[layoutName] ?? {}))
      }
    })

  // Validation: normalize problems (ids, actions, icons) + geometry on every device preset
  const problems = useMemo(() => {
    const normalized = normalizeTouchConfig(touch, actions)
    const geometry = findLayoutIssues(resolved, DEVICE_PRESETS, actionTypes)
    return [
      ...normalized.warnings
        .filter((w) => !w.includes('Layout ') || w.startsWith(isDefault ? 'Layout default' : `Layout ${layoutName}`))
        .map((m) => ({ severity: 'error' as const, message: m, buttons: [] as string[] })),
      ...geometry.map((g) => ({ severity: g.severity, message: g.message, buttons: g.buttons })),
    ]
  }, [touch, actions, resolved, actionTypes, isDefault, layoutName])

  const addButtonFor = (actionName: string) => {
    let id = actionName.replace(/[^A-Za-z0-9_-]/g, '') || 'Button'
    const ids = new Set(buttons.map((b) => b.id))
    if (ids.has(id)) {
      let n = 2
      while (ids.has(`${id}${n}`)) n++
      id = `${id}${n}`
    }
    const defaults = BUTTON_DEFAULTS[actionName] ?? { label: actionName.slice(0, 6).toUpperCase(), icon: '', behavior: 'hold' as const }
    update((d) => {
      editButtons(d).push({ id, action: actionName, anchor: 'bottom-right', unit: 'px', x: 24, y: 200, size: 56, ...defaults })
    })
    setSelectedId(id)
  }

  const device = DEVICE_PRESETS.find((p) => p.id === deviceId) ?? DEVICE_PRESETS[0]
  const vp = isLandscape ? landscape(device) : { width: Math.min(device.width, device.height), height: Math.max(device.width, device.height) }
  const previewScale = Math.min(330 / vp.width, 330 / vp.height)
  const scale = touchScale(resolved, vp)
  const joy = joystickRestRect(resolved, vp, scale)

  const startDrag = (b: TouchButtonDef, e: React.PointerEvent) => {
    e.preventDefault()
    setSelectedId(b.id)
    const start = { x: e.clientX, y: e.clientY, bx: b.x ?? 24, by: b.y ?? 24 }
    const anchor = b.anchor ?? 'bottom-right'
    const percent = b.unit === '%'
    const move = (ev: PointerEvent) => {
      // Screen px -> the button's own unit (logical px before scaling, or % of the side)
      const dxScreen = (ev.clientX - start.x) / previewScale
      const dyScreen = (ev.clientY - start.y) / previewScale
      const dx = percent ? (dxScreen / vp.width) * 100 : dxScreen / scale
      const dy = percent ? (dyScreen / vp.height) * 100 : dyScreen / scale
      updateButton(b.id, (t) => {
        t.x = Math.max(0, Math.round((start.bx + (anchor.endsWith('right') ? -dx : dx)) * 10) / 10)
        t.y = Math.max(0, Math.round((start.by + (anchor.startsWith('bottom') ? -dy : dy)) * 10) / 10)
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const num = (v: string, fallback: number) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }

  return (
    <div className="flex-1 flex overflow-hidden" data-testid="touch-editor">
      {/* Left: layouts + buttons */}
      <div className="w-52 border-r border-gray-700/50 bg-[#121b33] p-2.5 flex flex-col gap-2 overflow-y-auto">
        <div className="font-semibold text-gray-400 uppercase text-[10px]">Layout</div>
        <div className="flex flex-wrap gap-1">
          {layoutNames.map((n) => (
            <button
              key={n}
              onClick={() => setLayoutName(n)}
              className={`px-2 py-0.5 rounded text-[11px] ${layoutName === n ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
            >
              {n}
              {touch.initialLayout === n || (!touch.initialLayout && n === 'default') ? ' ★' : ''}
            </button>
          ))}
          <button
            className="px-2 py-0.5 rounded text-[11px] bg-white/5 text-gray-300 hover:bg-white/10"
            title="Layout baru (mis. kendaraan)"
            onClick={() => {
              let n = 1
              while (layoutNames.includes(`layout${n}`)) n++
              const name = `layout${n}`
              update((d) => {
                d.layouts = { ...(d.layouts ?? {}), [name]: {} }
              })
              setLayoutName(name)
            }}
          >
            +
          </button>
        </div>
        {!isDefault && (
          <div className="flex flex-col gap-1">
            <input
              className={inputCls}
              defaultValue={layoutName}
              key={layoutName}
              title="Nama layout (dipakai di ctx.touch.setLayout)"
              onBlur={(e) => {
                const next = e.target.value.replace(/[^A-Za-z0-9_-]/g, '')
                if (!next || next === layoutName || next === 'default' || layoutNames.includes(next)) return
                update((d) => {
                  const l = d.layouts![layoutName]
                  delete d.layouts![layoutName]
                  d.layouts![next] = l
                  if (d.initialLayout === layoutName) d.initialLayout = next
                })
                setLayoutName(next)
              }}
            />
            <div className="flex gap-1">
              <button className="flex-1 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[11px]" onClick={() => update((d) => (d.initialLayout = layoutName))}>
                Jadikan awal
              </button>
              <button
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-red-500/30 text-[11px] text-red-300"
                onClick={() => {
                  update((d) => {
                    delete d.layouts![layoutName]
                    if (d.initialLayout === layoutName) delete d.initialLayout
                  })
                  setLayoutName('default')
                }}
              >
                Hapus
              </button>
            </div>
          </div>
        )}

        <div className="font-semibold text-gray-400 uppercase text-[10px] mt-2">Tombol</div>
        {inheritsButtons && (
          <div className="text-[10px] text-gray-500 leading-relaxed">
            Mewarisi tombol layout default. Mengubah tombol di sini membuat salinan khusus layout ini.
          </div>
        )}
        <div className="space-y-1">
          {buttons.map((b) => (
            <div
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between gap-1 ${
                selectedId === b.id ? 'bg-blue-600 text-white' : 'hover:bg-white/5 text-gray-300'
              }`}
            >
              <span className="truncate">{b.label || b.id}</span>
              <span className={`text-[10px] truncate ${b.action && actionTypes[b.action] ? 'text-gray-400' : 'text-red-400'}`}>
                {b.action || 'tanpa action'}
              </span>
            </div>
          ))}
        </div>
        <select
          value=""
          onChange={(e) => e.target.value && addButtonFor(e.target.value)}
          className={`${inputCls} text-[11px]`}
          data-testid="add-touch-button"
        >
          <option value="">+ Tombol untuk action…</option>
          {usableActions.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Middle: settings */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {showReport && report && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded p-2 text-[11px] text-amber-200 space-y-1">
            <div className="flex justify-between">
              <b>Kontrol sentuh diperbarui ke format baru</b>
              <button onClick={() => setShowReport(false)}>✕</button>
            </div>
            {report.migrated > 0 && <div>{report.migrated} tombol dihubungkan ke action berdasarkan binding lama.</div>}
            {report.warnings.map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        )}

        <div className="bg-[#121b33] p-3 rounded-lg border border-gray-700/40 grid grid-cols-1 gap-y-2">
          {isDefault && (
            <Field label="Tampilkan">
              <select value={touch.enabled} onChange={(e) => update((d) => (d.enabled = e.target.value as TouchLayout['enabled']))} className={`flex-1 ${inputCls}`}>
                <option value="auto">Otomatis (perangkat sentuh)</option>
                <option value="always">Selalu</option>
                <option value="never">Tidak pernah</option>
              </select>
            </Field>
          )}
          <Field label="Skala" hint="auto = menyesuaikan sisi pendek layar (0.8–1.5×)">
            <select
              value={resolved.scale === 'auto' || resolved.scale === undefined ? 'auto' : String(resolved.scale)}
              onChange={(e) => updateLayoutField((t) => (t.scale = e.target.value === 'auto' ? 'auto' : num(e.target.value, 1)))}
              className={`flex-1 ${inputCls}`}
            >
              <option value="auto">Otomatis</option>
              {['0.8', '1', '1.25', '1.5'].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </Field>
          <Field label="Joystick">
            <select
              value={resolved.joystick.mode}
              onChange={(e) => updateLayoutField((t) => (t.joystick = { ...resolved.joystick, mode: e.target.value as 'floating' | 'fixed' }))}
              className={`flex-1 ${inputCls}`}
            >
              <option value="floating">Floating</option>
              <option value="fixed">Fixed</option>
            </select>
            <select
              value={resolved.joystick.side}
              onChange={(e) => updateLayoutField((t) => (t.joystick = { ...resolved.joystick, side: e.target.value as 'left' | 'right' }))}
              className={inputCls}
            >
              <option value="left">Kiri</option>
              <option value="right">Kanan</option>
            </select>
          </Field>
          <Field label="Radius">
            <input
              type="number"
              value={resolved.joystick.radius}
              onChange={(e) => updateLayoutField((t) => (t.joystick = { ...resolved.joystick, radius: Math.max(24, num(e.target.value, 64)) }))}
              className={`w-20 ${inputCls}`}
            />
          </Field>
          <Field label="Seret melihat">
            <input
              type="checkbox"
              checked={resolved.look.enabled}
              onChange={(e) => updateLayoutField((t) => (t.look = { ...resolved.look, enabled: e.target.checked }))}
            />
          </Field>
          <Field label="Opacity">
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={resolved.opacity}
              onChange={(e) => updateLayoutField((t) => (t.opacity = num(e.target.value, 0.6)))}
              className="flex-1"
            />
          </Field>
        </div>

        {selected ? (
          <div className="bg-[#121b33] p-3 rounded-lg border border-gray-700/40 space-y-2" data-testid="touch-button-props">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-300">Tombol "{selected.id}"</span>
              <button
                className="text-red-400 hover:text-red-300 text-[11px]"
                onClick={() => {
                  update((d) => {
                    const list = editButtons(d)
                    list.splice(list.findIndex((b) => b.id === selected.id), 1)
                  })
                  setSelectedId(null)
                }}
              >
                Hapus tombol
              </button>
            </div>
            <div className="grid grid-cols-1 gap-y-2">
              <Field label="Action" hint="Input Action yang dipicu tombol ini">
                <select value={selected.action} onChange={(e) => updateButton(selected.id, (b) => (b.action = e.target.value))} className={`flex-1 ${inputCls}`} data-testid="button-action">
                  {!actionTypes[selected.action] && <option value={selected.action}>{selected.action || '— pilih —'}</option>}
                  {usableActions.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name} ({a.type})
                    </option>
                  ))}
                </select>
              </Field>
              {actionTypes[selected.action] === 'axis' ? (
                <Field label="Arah" hint="Untuk action axis: tombol mendorong ke −1 atau +1">
                  <select value={selected.value === -1 ? '-1' : '1'} onChange={(e) => updateButton(selected.id, (b) => (b.value = e.target.value === '-1' ? -1 : 1))} className={`flex-1 ${inputCls}`}>
                    <option value="-1">−1 (mis. Q / kiri / turun)</option>
                    <option value="1">+1 (mis. E / kanan / naik)</option>
                  </select>
                </Field>
              ) : null}
              <Field label="Id" hint="Nama unik; dipakai ctx.touch.show/hide/setLabel. Mengganti id tidak memutus action">
                <input
                  key={selected.id}
                  defaultValue={selected.id}
                  className={`flex-1 ${inputCls}`}
                  onBlur={(e) => {
                    const next = e.target.value.replace(/[^A-Za-z0-9_-]/g, '')
                    if (!next || next === selected.id || buttons.some((b) => b.id === next)) {
                      e.target.value = selected.id
                      return
                    }
                    updateButton(selected.id, (b) => (b.id = next))
                    setSelectedId(next)
                  }}
                />
              </Field>
              <Field label="Label">
                <input value={selected.label ?? ''} maxLength={16} onChange={(e) => updateButton(selected.id, (b) => (b.label = e.target.value))} className={`flex-1 ${inputCls}`} data-testid="button-label" />
              </Field>
              <Field label="Perilaku">
                <select value={selected.behavior ?? 'hold'} onChange={(e) => updateButton(selected.id, (b) => (b.behavior = e.target.value as TouchButtonDef['behavior']))} className={`flex-1 ${inputCls}`} data-testid="button-behavior">
                  {BEHAVIORS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              {selected.behavior === 'repeat' ? (
                <Field label="Interval (s)">
                  <input type="number" step={0.05} min={0.05} value={selected.repeatInterval ?? 0.15} onChange={(e) => updateButton(selected.id, (b) => (b.repeatInterval = num(e.target.value, 0.15)))} className={`w-20 ${inputCls}`} />
                </Field>
              ) : null}
              <Field label="Cooldown (s)" hint="Tombol nonaktif sesudah dipicu, dengan sapuan radial">
                <input type="number" step={0.1} min={0} value={selected.cooldown ?? 0} onChange={(e) => updateButton(selected.id, (b) => (b.cooldown = num(e.target.value, 0) || undefined))} className={`w-20 ${inputCls}`} data-testid="button-cooldown" />
              </Field>
              <Field label="Bentuk">
                <select value={selected.shape ?? 'circle'} onChange={(e) => updateButton(selected.id, (b) => (b.shape = e.target.value as TouchButtonDef['shape']))} className={`flex-1 ${inputCls}`}>
                  <option value="circle">Lingkaran</option>
                  <option value="rounded">Kotak membulat</option>
                  <option value="square">Kotak</option>
                </select>
              </Field>
              {(['color', 'pressedColor', 'textColor'] as const).map((key) => (
                <Field key={key} label={key === 'color' ? 'Warna' : key === 'pressedColor' ? 'Warna ditekan' : 'Warna teks'}>
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(selected[key] ?? '') ? selected[key]! : key === 'textColor' ? '#ffffff' : key === 'color' ? '#0f172a' : '#3b82f6'}
                    onChange={(e) => updateButton(selected.id, (b) => (b[key] = e.target.value))}
                    className="w-8 h-6 bg-transparent"
                  />
                  {selected[key] && (
                    <button className="text-[10px] text-gray-500 hover:text-gray-300" onClick={() => updateButton(selected.id, (b) => delete b[key])}>
                      reset
                    </button>
                  )}
                </Field>
              ))}
              <Field label="Opacity">
                <input type="range" min={0.1} max={1} step={0.05} value={selected.opacity ?? resolved.opacity} onChange={(e) => updateButton(selected.id, (b) => (b.opacity = num(e.target.value, 0.6)))} className="flex-1" />
              </Field>
              <Field label="Ukuran (px)">
                <input type="number" min={24} max={240} value={selected.size ?? 56} onChange={(e) => updateButton(selected.id, (b) => (b.size = num(e.target.value, 56)))} className={`w-20 ${inputCls}`} />
              </Field>
              <Field label="Jangkar">
                <select value={selected.anchor ?? 'bottom-right'} onChange={(e) => updateButton(selected.id, (b) => (b.anchor = e.target.value as TouchButtonDef['anchor']))} className={`flex-1 ${inputCls}`}>
                  {ANCHOR_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="X / Y">
                <input type="number" value={selected.x ?? 24} onChange={(e) => updateButton(selected.id, (b) => (b.x = num(e.target.value, 0)))} className={`w-16 ${inputCls}`} />
                <input type="number" value={selected.y ?? 24} onChange={(e) => updateButton(selected.id, (b) => (b.y = num(e.target.value, 0)))} className={`w-16 ${inputCls}`} />
                <select value={selected.unit ?? 'px'} onChange={(e) => updateButton(selected.id, (b) => (b.unit = e.target.value as 'px' | '%'))} className={inputCls}>
                  <option value="px">px</option>
                  <option value="%">%</option>
                </select>
              </Field>
              <Field label="Awal">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={selected.visible !== false} onChange={(e) => updateButton(selected.id, (b) => (e.target.checked ? delete b.visible : (b.visible = false)))} />
                  tampil
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={selected.enabled !== false} onChange={(e) => updateButton(selected.id, (b) => (e.target.checked ? delete b.enabled : (b.enabled = false)))} />
                  aktif
                </label>
              </Field>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Ikon</div>
              <div className="flex flex-wrap gap-1">
                <button
                  className={`w-8 h-8 rounded border text-[10px] ${!selected.icon ? 'border-blue-500 bg-blue-500/20' : 'border-gray-700 hover:bg-white/10'}`}
                  onClick={() => updateButton(selected.id, (b) => delete b.icon)}
                  title="Tanpa ikon"
                >
                  —
                </button>
                {BUILTIN_ICONS.map((name) => (
                  <button
                    key={name}
                    title={name}
                    onClick={() => updateButton(selected.id, (b) => (b.icon = name))}
                    className={`w-8 h-8 rounded border flex items-center justify-center text-gray-200 ${selected.icon === name ? 'border-blue-500 bg-blue-500/20' : 'border-gray-700 hover:bg-white/10'}`}
                    dangerouslySetInnerHTML={{ __html: builtinIconSvg(name, 18) ?? '' }}
                  />
                ))}
              </div>
              <input
                className={`mt-1.5 w-full ${inputCls} text-[11px]`}
                placeholder="atau gambar: assets/ui/sword.png (png, svg, webp)"
                value={selected.icon?.startsWith('asset:') ? selected.icon.slice(6) : ''}
                onChange={(e) =>
                  updateButton(selected.id, (b) => {
                    const path = e.target.value.trim()
                    if (path) b.icon = `asset:${path}`
                    else delete b.icon
                  })
                }
              />
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-center py-6">Pilih tombol di kiri, atau tambahkan tombol untuk sebuah action.</div>
        )}
      </div>

      {/* Right: device preview + validation */}
      <div className="w-[360px] border-l border-gray-700/50 bg-[#121b33] p-3 flex flex-col items-center gap-2 overflow-y-auto">
        <div className="flex gap-1 items-center">
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={`${inputCls} text-[11px]`}>
            {DEVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {[true, false].map((l) => (
            <button
              key={String(l)}
              onClick={() => setIsLandscape(l)}
              className={`px-2 py-0.5 rounded text-[11px] ${isLandscape === l ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/10'}`}
            >
              {l ? 'Landscape' : 'Portrait'}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-gray-500">
          {vp.width}×{vp.height} · skala {scale.toFixed(2)}×
        </div>
        <div className="relative bg-black/60 border border-gray-600 rounded-lg overflow-hidden" style={{ width: vp.width * previewScale, height: vp.height * previewScale }}>
          <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/10" />
          <div
            className="absolute rounded-full border-2 border-white/40 bg-white/10"
            style={{
              left: (joy.cx - joy.radius) * previewScale,
              top: (joy.cy - joy.radius) * previewScale,
              width: joy.radius * 2 * previewScale,
              height: joy.radius * 2 * previewScale,
              opacity: resolved.opacity,
            }}
          />
          {buttons.map((b) => {
            const r = buttonRect(b, vp, scale)
            const radius = b.shape === 'square' ? '8%' : b.shape === 'rounded' ? '28%' : '50%'
            const flagged = problems.some((p) => p.buttons.includes(b.id))
            return (
              <div
                key={b.id}
                onPointerDown={(e) => startDrag(b, e)}
                className={`absolute flex flex-col items-center justify-center cursor-move font-bold border ${selectedId === b.id ? 'ring-2 ring-blue-400' : ''} ${flagged ? 'border-amber-400' : 'border-white/50'}`}
                style={{
                  left: r.x * previewScale,
                  top: r.y * previewScale,
                  width: r.size * previewScale,
                  height: r.size * previewScale,
                  borderRadius: radius,
                  background: b.color ?? 'rgba(15,23,42,.6)',
                  color: b.textColor ?? '#fff',
                  fontSize: Math.max(7, r.size * previewScale * 0.24),
                  opacity: b.visible === false ? 0.35 : b.opacity ?? resolved.opacity,
                }}
                title={`${b.id} → ${b.action || 'tanpa action'} (seret untuk memindah)`}
              >
                {b.icon && !b.icon.startsWith('asset:') && (
                  <span dangerouslySetInnerHTML={{ __html: builtinIconSvg(b.icon, Math.max(8, Math.round(r.size * previewScale * 0.34))) ?? '' }} />
                )}
                <span>{b.label ?? ''}</span>
              </div>
            )
          })}
        </div>
        <div className="w-full space-y-1" data-testid="touch-problems">
          <div className="font-semibold text-gray-400 uppercase text-[10px]">Validasi ({problems.length})</div>
          {problems.length === 0 && <div className="text-[11px] text-emerald-400">Tidak ada masalah di semua perangkat.</div>}
          {problems.map((p, i) => (
            <div
              key={i}
              onClick={() => p.buttons[0] && setSelectedId(p.buttons[0])}
              className={`text-[11px] leading-snug cursor-pointer ${p.severity === 'error' ? 'text-red-400' : 'text-amber-300'}`}
            >
              • {p.message}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-500 text-center leading-relaxed">
          Separuh kiri = joystick, separuh kanan = seret untuk melihat. Uji di Game View dengan "Sentuh: On".
        </p>
      </div>
    </div>
  )
}
