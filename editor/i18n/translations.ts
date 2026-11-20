/**
 * Editor UI Localization dictionaries & reactive hook for Linden Engine.
 * Supports en-US (English), id-ID (Bahasa Indonesia), ja-JP (日本語), zh-CN (简体中文), and es-ES (Español).
 * Automatically persists user language preference in localStorage.
 */

import { useState, useEffect } from 'react'

export type EditorLocale = 'en-US' | 'id-ID' | 'ja-JP' | 'zh-CN' | 'es-ES'

export const LOCALE_STORAGE_KEY = 'linden:editorLocale'

export const EDITOR_LANGUAGES: { code: EditorLocale; label: string; nativeName: string }[] = [
  { code: 'en-US', label: 'English', nativeName: 'English' },
  { code: 'id-ID', label: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ja-JP', label: 'Japanese', nativeName: '日本語' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'es-ES', label: 'Spanish', nativeName: 'Español' },
]

export const EDITOR_TRANSLATIONS: Record<EditorLocale, Record<string, string>> = {
  'en-US': {
    // Menu Bar
    'menu.file': 'File',
    'menu.edit': 'Edit',
    'menu.gameobject': 'GameObject',
    'menu.window': 'Window',
    'menu.help': 'Help',
    'menu.new_project': 'New Project',
    'menu.open_project': 'Open Project',
    'menu.close_project': 'Close Project',
    'menu.new_scene': 'New Scene',
    'menu.open_scene': 'Open Scene',
    'menu.save_scene': 'Save Scene',
    'menu.save_scene_as': 'Save Scene As…',
    'menu.recent_projects': 'Recent Projects',
    'menu.no_recent_projects': 'No Recent Projects',
    'menu.clear_recent_projects': 'Clear Recent Projects',
    'menu.import_godot_project': 'Import Godot Project…',
    'menu.project_settings': 'Project Settings…',
    'menu.input_actions': 'Input Actions…',
    'menu.export': 'Export…',
    'menu.exit': 'Exit',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.delete': 'Delete',
    'menu.create_empty': 'Create Empty',
    'menu.object_3d': '3D Object',
    'menu.cube': 'Cube',
    'menu.sphere': 'Sphere',
    'menu.capsule': 'Capsule',
    'menu.cylinder': 'Cylinder',
    'menu.plane': 'Plane',
    'menu.reset_layout': 'Reset Layout',

    // Toolbar & Controls
    'toolbar.play': 'Play',
    'toolbar.playing': 'Playing',
    'toolbar.pause': 'Pause',
    'toolbar.stop': 'Stop',
    'toolbar.step': 'Step',
    'toolbar.move_tool': 'Move Tool (W)',
    'toolbar.rotate_tool': 'Rotate Tool (E)',
    'toolbar.scale_tool': 'Scale Tool (R)',
    'toolbar.open_agent': 'Open AI Agent panel',
    'toolbar.agent_status': 'Agent: {activity}',
    'toolbar.language_select': 'Change Editor Language',

    // Panels & Tab Navigation
    'panel.hierarchy': 'Hierarchy',
    'panel.viewport': 'Viewport',
    'panel.bridge': 'Bridge',
    'panel.project': 'Project',
    'panel.assets': 'Assets',
    'panel.console': 'Console',
    'panel.output': 'Output',
    'panel.split_all': 'Split All',
    'panel.inspector': 'Inspector',
    'panel.scene': 'Scene',
    'panel.agent': 'AI Agent',
    'panel.godot': 'Godot Bridge',

    // Hierarchy Panel
    'hierarchy.title': 'Hierarchy',
    'hierarchy.search_placeholder': 'Search by name or t:TagName...',
    'hierarchy.create_empty': 'Create Empty',
    'hierarchy.3d_object': '3D Object',
    'hierarchy.duplicate': 'Duplicate',
    'hierarchy.delete': 'Delete',
    'hierarchy.unpack_prefab': 'Unpack Prefab',
    'hierarchy.empty_scene': 'No entities in this scene',

    // Inspector Panel
    'inspector.title': 'Inspector',
    'inspector.no_selection': 'Select an entity to view properties',
    'inspector.multi_selection': '{count} entities selected',
    'inspector.name': 'Name',
    'inspector.tag': 'Tag',
    'inspector.tags': 'Tags',
    'inspector.add_tag': '+ Add Tag...',
    'inspector.layer': 'Layer',
    'inspector.active': 'Active',
    'inspector.static': 'Static',
    'inspector.transform': 'Transform',
    'inspector.position': 'Position',
    'inspector.rotation': 'Rotation',
    'inspector.scale': 'Scale',
    'inspector.components': 'Components',
    'inspector.add_component': 'Add Component',
    'inspector.search_components': 'Search components...',
    'inspector.remove_component': 'Remove Component',
    'inspector.script_language': 'Language',
    'inspector.script_src': 'Script',
    'inspector.transmute': 'Transmute to...',

    // Asset Browser
    'assets.title': 'Asset Browser',
    'assets.search_placeholder': 'Search assets...',
    'assets.import': 'Import Asset',
    'assets.refresh': 'Refresh',
    'assets.no_assets': 'No assets found in folder',

    // Console Panel
    'console.title': 'Console',
    'console.clear': 'Clear',
    'console.filter_all': 'All',
    'console.logs': 'Logs',
    'console.warnings': 'Warnings',
    'console.errors': 'Errors',
    'console.search_placeholder': 'Filter console messages...',

    // Agent Panel
    'agent.title': 'AI Agent',
    'agent.prompt_placeholder': 'Describe your game or mechanics (e.g. 3D platformer with double jump)...',
    'agent.send': 'Generate',
    'agent.thinking': 'Agent is thinking...',
    'agent.stop': 'Stop Agent',
    'agent.diff_apply': 'Apply All Changes',
    'agent.diff_reject': 'Reject Changes',

    // Status Bar & Dialogs
    'status.project': 'Project:',
    'status.scene': 'Scene:',
    'status.bridge_active': 'Bridge Sync Active',
    'status.bridge_offline': 'Bridge Sync Offline',
    'dialog.confirm': 'Confirm',
    'dialog.cancel': 'Cancel',
    'dialog.close': 'Close',
    'dialog.ok': 'OK',
    'dialog.save': 'Save',
    'dialog.discard': 'Discard',
  },

  'id-ID': {
    // Menu Bar
    'menu.file': 'Berkas',
    'menu.edit': 'Ubah',
    'menu.gameobject': 'Objek Game',
    'menu.window': 'Jendela',
    'menu.help': 'Bantuan',
    'menu.new_project': 'Proyek Baru',
    'menu.open_project': 'Buka Proyek',
    'menu.close_project': 'Tutup Proyek',
    'menu.new_scene': 'Scene Baru',
    'menu.open_scene': 'Buka Scene',
    'menu.save_scene': 'Simpan Scene',
    'menu.save_scene_as': 'Simpan Scene Sebagai…',
    'menu.recent_projects': 'Proyek Terkini',
    'menu.no_recent_projects': 'Tidak Ada Proyek Terkini',
    'menu.clear_recent_projects': 'Hapus Riwayat Proyek',
    'menu.import_godot_project': 'Impor Proyek Godot…',
    'menu.project_settings': 'Pengaturan Proyek…',
    'menu.input_actions': 'Aksi Input…',
    'menu.export': 'Ekspor…',
    'menu.exit': 'Keluar',
    'menu.undo': 'Urungkan (Undo)',
    'menu.redo': 'Ulangi (Redo)',
    'menu.cut': 'Potong',
    'menu.copy': 'Salin',
    'menu.paste': 'Tempel',
    'menu.delete': 'Hapus',
    'menu.create_empty': 'Buat Objek Kosong',
    'menu.object_3d': 'Objek 3D',
    'menu.cube': 'Kubus (Cube)',
    'menu.sphere': 'Bola (Sphere)',
    'menu.capsule': 'Kapsul (Capsule)',
    'menu.cylinder': 'Silinder (Cylinder)',
    'menu.plane': 'Bidang (Plane)',
    'menu.reset_layout': 'Reset Tata Letak',

    // Toolbar & Kontrol
    'toolbar.play': 'Mainkan',
    'toolbar.playing': 'Sedang Main',
    'toolbar.pause': 'Jeda',
    'toolbar.stop': 'Berhenti',
    'toolbar.step': 'Langkah',
    'toolbar.move_tool': 'Alat Geser (W)',
    'toolbar.rotate_tool': 'Alat Putar (E)',
    'toolbar.scale_tool': 'Alat Skala (R)',
    'toolbar.open_agent': 'Buka panel AI Agent',
    'toolbar.agent_status': 'Agen: {activity}',
    'toolbar.language_select': 'Ganti Bahasa Editor',

    // Panel & Navigasi Tab
    'panel.hierarchy': 'Hirarki',
    'panel.viewport': 'Viewport',
    'panel.bridge': 'Jembatan (Bridge)',
    'panel.project': 'Proyek',
    'panel.assets': 'Aset',
    'panel.console': 'Konsol',
    'panel.output': 'Keluaran',
    'panel.split_all': 'Bagi Semua',
    'panel.inspector': 'Inspektur',
    'panel.scene': 'Scene',
    'panel.agent': 'AI Agent',
    'panel.godot': 'Jembatan Godot',

    // Panel Hirarki
    'hierarchy.title': 'Hirarki',
    'hierarchy.search_placeholder': 'Cari berdasarkan nama atau t:NamaTag...',
    'hierarchy.create_empty': 'Buat Kosong',
    'hierarchy.3d_object': 'Objek 3D',
    'hierarchy.duplicate': 'Duplikat',
    'hierarchy.delete': 'Hapus',
    'hierarchy.unpack_prefab': 'Bongkar Prefab',
    'hierarchy.empty_scene': 'Belum ada entity di scene ini',

    // Panel Inspektur
    'inspector.title': 'Inspektur',
    'inspector.no_selection': 'Pilih entity untuk melihat properti',
    'inspector.multi_selection': '{count} entity terpilih',
    'inspector.name': 'Nama',
    'inspector.tag': 'Tag',
    'inspector.tags': 'Tag',
    'inspector.add_tag': '+ Tambah Tag...',
    'inspector.layer': 'Lapisan (Layer)',
    'inspector.active': 'Aktif',
    'inspector.static': 'Statis',
    'inspector.transform': 'Transformasi',
    'inspector.position': 'Posisi',
    'inspector.rotation': 'Rotasi',
    'inspector.scale': 'Skala',
    'inspector.components': 'Komponen',
    'inspector.add_component': 'Tambah Komponen',
    'inspector.search_components': 'Cari komponen...',
    'inspector.remove_component': 'Hapus Komponen',
    'inspector.script_language': 'Bahasa Script',
    'inspector.script_src': 'File Script',
    'inspector.transmute': 'Transmutasi ke...',

    // Penjelajah Aset
    'assets.title': 'Penjelajah Aset',
    'assets.search_placeholder': 'Cari aset...',
    'assets.import': 'Impor Aset',
    'assets.refresh': 'Segarkan',
    'assets.no_assets': 'Tidak ada aset di folder ini',

    // Panel Konsol
    'console.title': 'Konsol',
    'console.clear': 'Bersihkan',
    'console.filter_all': 'Semua',
    'console.logs': 'Log',
    'console.warnings': 'Peringatan',
    'console.errors': 'Galat',
    'console.search_placeholder': 'Saring pesan konsol...',

    // Panel Agen
    'agent.title': 'AI Agent',
    'agent.prompt_placeholder': 'Deskripsikan game atau mekanik (misal: platformer 3D dengan double jump)...',
    'agent.send': 'Hasilkan',
    'agent.thinking': 'Agent sedang berpikir...',
    'agent.stop': 'Hentikan Agen',
    'agent.diff_apply': 'Terapkan Semua Perubahan',
    'agent.diff_reject': 'Tolak Perubahan',

    // Bilah Status & Dialog
    'status.project': 'Proyek:',
    'status.scene': 'Scene:',
    'status.bridge_active': 'Sinkronisasi Bridge Aktif',
    'status.bridge_offline': 'Sinkronisasi Bridge Terputus',
    'dialog.confirm': 'Konfirmasi',
    'dialog.cancel': 'Batal',
    'dialog.close': 'Tutup',
    'dialog.ok': 'OK',
    'dialog.save': 'Simpan',
    'dialog.discard': 'Buang',
  },

  'ja-JP': {
    // メニューバー
    'menu.file': 'ファイル',
    'menu.edit': '編集',
    'menu.gameobject': 'ゲームオブジェクト',
    'menu.window': 'ウィンドウ',
    'menu.help': 'ヘルプ',
    'menu.new_project': '新規プロジェクト',
    'menu.open_project': 'プロジェクトを開く',
    'menu.close_project': 'プロジェクトを閉じる',
    'menu.new_scene': '新規シーン',
    'menu.open_scene': 'シーンを開く',
    'menu.save_scene': 'シーンを保存',
    'menu.save_scene_as': '名前を付けてシーンを保存…',
    'menu.recent_projects': '最近のプロジェクト',
    'menu.no_recent_projects': '最近のプロジェクトはありません',
    'menu.clear_recent_projects': '履歴をクリア',
    'menu.import_godot_project': 'Godotプロジェクトをインポート…',
    'menu.project_settings': 'プロジェクト設定…',
    'menu.input_actions': '入力アクション…',
    'menu.export': 'エクスポート…',
    'menu.exit': '終了',
    'menu.undo': '元に戻す',
    'menu.redo': 'やり直し',
    'menu.cut': '切り取り',
    'menu.copy': 'コピー',
    'menu.paste': '貼り付け',
    'menu.delete': '削除',
    'menu.create_empty': '空のオブジェクトを作成',
    'menu.object_3d': '3Dオブジェクト',
    'menu.cube': 'キューブ',
    'menu.sphere': '球体',
    'menu.capsule': 'カプセル',
    'menu.cylinder': '円柱',
    'menu.plane': '平面',
    'menu.reset_layout': 'レイアウトをリセット',

    // ツールバー
    'toolbar.play': 'プレイ',
    'toolbar.playing': '実行中',
    'toolbar.pause': '一時停止',
    'toolbar.stop': '停止',
    'toolbar.step': 'ステップ',
    'toolbar.move_tool': '移動ツール (W)',
    'toolbar.rotate_tool': '回転ツール (E)',
    'toolbar.scale_tool': '拡大縮小ツール (R)',
    'toolbar.open_agent': 'AIエージェントを開く',
    'toolbar.agent_status': 'エージェント: {activity}',
    'toolbar.language_select': '言語を変更',

    // パネル
    'panel.hierarchy': 'ヒエラルキー',
    'panel.viewport': 'ビューポート',
    'panel.bridge': 'ブリッジ',
    'panel.project': 'プロジェクト',
    'panel.assets': 'アセット',
    'panel.console': 'コンソール',
    'panel.output': '出力',
    'panel.split_all': 'すべて分割',
    'panel.inspector': 'インスペクター',
    'panel.scene': 'シーン',
    'panel.agent': 'AIエージェント',
    'panel.godot': 'Godotブリッジ',

    // ヒエラルキー
    'hierarchy.title': 'ヒエラルキー',
    'hierarchy.search_placeholder': '名前または t:タグ名 で検索...',
    'hierarchy.create_empty': '空のオブジェクト',
    'hierarchy.3d_object': '3Dオブジェクト',
    'hierarchy.duplicate': '複製',
    'hierarchy.delete': '削除',
    'hierarchy.unpack_prefab': 'プレハブを解除',
    'hierarchy.empty_scene': 'エンティティがありません',

    // インスペクター
    'inspector.title': 'インスペクター',
    'inspector.no_selection': 'エンティティを選択してプロパティを表示',
    'inspector.multi_selection': '{count} 件のエンティティを選択中',
    'inspector.name': '名前',
    'inspector.tag': 'タグ',
    'inspector.tags': 'タグ一覧',
    'inspector.add_tag': '+ タグを追加...',
    'inspector.layer': 'レイヤー',
    'inspector.active': 'アクティブ',
    'inspector.static': '静的',
    'inspector.transform': 'トランスフォーム',
    'inspector.position': '位置',
    'inspector.rotation': '回転',
    'inspector.scale': 'スケール',
    'inspector.components': 'コンポーネント',
    'inspector.add_component': 'コンポーネントを追加',
    'inspector.search_components': 'コンポーネントを検索...',
    'inspector.remove_component': 'コンポーネントを削除',
    'inspector.script_language': 'スクリプト言語',
    'inspector.script_src': 'スクリプトファイル',
    'inspector.transmute': '別言語へ変換...',

    // アセットブラウザ
    'assets.title': 'アセットブラウザ',
    'assets.search_placeholder': 'アセットを検索...',
    'assets.import': 'インポート',
    'assets.refresh': '更新',
    'assets.no_assets': 'アセットがありません',

    // コンソール
    'console.title': 'コンソール',
    'console.clear': 'クリア',
    'console.filter_all': 'すべて',
    'console.logs': 'ログ',
    'console.warnings': '警告',
    'console.errors': 'エラー',
    'console.search_placeholder': 'コンソールメッセージを絞り込み...',

    // エージェント
    'agent.title': 'AIエージェント',
    'agent.prompt_placeholder': 'ゲームやメカニクスを説明してください (例: 2段ジャンプ付き3Dアクション)...',
    'agent.send': '生成',
    'agent.thinking': 'エージェントが思考中...',
    'agent.stop': '停止',
    'agent.diff_apply': 'すべての変更を適用',
    'agent.diff_reject': '変更を破棄',

    // ステータス & ダイアログ
    'status.project': 'プロジェクト:',
    'status.scene': 'シーン:',
    'status.bridge_active': 'ブリッジ同期中',
    'status.bridge_offline': 'ブリッジ切断',
    'dialog.confirm': '確認',
    'dialog.cancel': 'キャンセル',
    'dialog.close': '閉じる',
    'dialog.ok': 'OK',
    'dialog.save': '保存',
    'dialog.discard': '破棄',
  },

  'zh-CN': {
    // 菜单栏
    'menu.file': '文件',
    'menu.edit': '编辑',
    'menu.gameobject': '游戏对象',
    'menu.window': '窗口',
    'menu.help': '帮助',
    'menu.new_project': '新建项目',
    'menu.open_project': '打开项目',
    'menu.close_project': '关闭项目',
    'menu.new_scene': '新建场景',
    'menu.open_scene': '打开场景',
    'menu.save_scene': '保存场景',
    'menu.save_scene_as': '场景另存为…',
    'menu.recent_projects': '最近项目',
    'menu.no_recent_projects': '无最近项目',
    'menu.clear_recent_projects': '清除历史记录',
    'menu.import_godot_project': '导入 Godot 项目…',
    'menu.project_settings': '项目设置…',
    'menu.input_actions': '输入动作…',
    'menu.export': '导出…',
    'menu.exit': '退出',
    'menu.undo': '撤销',
    'menu.redo': '重做',
    'menu.cut': '剪切',
    'menu.copy': '复制',
    'menu.paste': '粘贴',
    'menu.delete': '删除',
    'menu.create_empty': '创建空对象',
    'menu.object_3d': '3D 对象',
    'menu.cube': '立方体',
    'menu.sphere': '球体',
    'menu.capsule': '胶囊体',
    'menu.cylinder': '圆柱体',
    'menu.plane': '平面',
    'menu.reset_layout': '重置布局',

    // 工具栏
    'toolbar.play': '运行',
    'toolbar.playing': '运行中',
    'toolbar.pause': '暂停',
    'toolbar.stop': '停止',
    'toolbar.step': '单步',
    'toolbar.move_tool': '移动工具 (W)',
    'toolbar.rotate_tool': '旋转工具 (E)',
    'toolbar.scale_tool': '缩放工具 (R)',
    'toolbar.open_agent': '打开 AI 智能体面板',
    'toolbar.agent_status': '智能体: {activity}',
    'toolbar.language_select': '更改编辑器语言',

    // 面板
    'panel.hierarchy': '层级',
    'panel.viewport': '视口',
    'panel.bridge': '桥接',
    'panel.project': '项目',
    'panel.assets': '资产',
    'panel.console': '控制台',
    'panel.output': '输出',
    'panel.split_all': '全部拆分',
    'panel.inspector': '属性检视器',
    'panel.scene': '场景设置',
    'panel.agent': 'AI 智能体',
    'panel.godot': 'Godot 桥接',

    // 层级
    'hierarchy.title': '层级',
    'hierarchy.search_placeholder': '按名称或 t:标签 搜索...',
    'hierarchy.create_empty': '创建空对象',
    'hierarchy.3d_object': '3D 对象',
    'hierarchy.duplicate': '复制',
    'hierarchy.delete': '删除',
    'hierarchy.unpack_prefab': '解包预制体',
    'hierarchy.empty_scene': '场景中暂无实体',

    // 检视器
    'inspector.title': '属性检视器',
    'inspector.no_selection': '选择实体以查看属性',
    'inspector.multi_selection': '已选择 {count} 个实体',
    'inspector.name': '名称',
    'inspector.tag': '标签',
    'inspector.tags': '标签列表',
    'inspector.add_tag': '+ 添加标签...',
    'inspector.layer': '图层',
    'inspector.active': '激活',
    'inspector.static': '静态',
    'inspector.transform': '变换',
    'inspector.position': '位置',
    'inspector.rotation': '旋转',
    'inspector.scale': '缩放',
    'inspector.components': '组件',
    'inspector.add_component': '添加组件',
    'inspector.search_components': '搜索组件...',
    'inspector.remove_component': '移除组件',
    'inspector.script_language': '脚本语言',
    'inspector.script_src': '脚本文件',
    'inspector.transmute': '转换至...',

    // 资产
    'assets.title': '资产浏览器',
    'assets.search_placeholder': '搜索资产...',
    'assets.import': '导入资产',
    'assets.refresh': '刷新',
    'assets.no_assets': '文件夹内暂无资产',

    // 控制台
    'console.title': '控制台',
    'console.clear': '清除',
    'console.filter_all': '全部',
    'console.logs': '日志',
    'console.warnings': '警告',
    'console.errors': '错误',
    'console.search_placeholder': '过滤控制台信息...',

    // 智能体
    'agent.title': 'AI 智能体',
    'agent.prompt_placeholder': '描述您的游戏或机制 (例如: 带有二段跳的3D动作游戏)...',
    'agent.send': '生成',
    'agent.thinking': '智能体思考中...',
    'agent.stop': '停止智能体',
    'agent.diff_apply': '应用所有更改',
    'agent.diff_reject': '拒绝更改',

    // 状态栏
    'status.project': '项目:',
    'status.scene': '场景:',
    'status.bridge_active': '桥接同步中',
    'status.bridge_offline': '桥接已离线',
    'dialog.confirm': '确认',
    'dialog.cancel': '取消',
    'dialog.close': '关闭',
    'dialog.ok': '确定',
    'dialog.save': '保存',
    'dialog.discard': '放弃',
  },

  'es-ES': {
    // Barra de menús
    'menu.file': 'Archivo',
    'menu.edit': 'Editar',
    'menu.gameobject': 'Objeto del Juego',
    'menu.window': 'Ventana',
    'menu.help': 'Ayuda',
    'menu.new_project': 'Nuevo Proyecto',
    'menu.open_project': 'Abrir Proyecto',
    'menu.close_project': 'Cerrar Proyecto',
    'menu.new_scene': 'Nueva Escena',
    'menu.open_scene': 'Abrir Escena',
    'menu.save_scene': 'Guardar Escena',
    'menu.save_scene_as': 'Guardar Escena Como…',
    'menu.recent_projects': 'Proyectos Recientes',
    'menu.no_recent_projects': 'Sin Proyectos Recientes',
    'menu.clear_recent_projects': 'Limpiar Historial',
    'menu.import_godot_project': 'Importar Proyecto Godot…',
    'menu.project_settings': 'Configuración del Proyecto…',
    'menu.input_actions': 'Acciones de Entrada…',
    'menu.export': 'Exportar…',
    'menu.exit': 'Salir',
    'menu.undo': 'Deshacer',
    'menu.redo': 'Rehacer',
    'menu.cut': 'Cortar',
    'menu.copy': 'Copiar',
    'menu.paste': 'Pegar',
    'menu.delete': 'Eliminar',
    'menu.create_empty': 'Crear Vacío',
    'menu.object_3d': 'Objeto 3D',
    'menu.cube': 'Cubo',
    'menu.sphere': 'Esfera',
    'menu.capsule': 'Cápsula',
    'menu.cylinder': 'Cilindro',
    'menu.plane': 'Plano',
    'menu.reset_layout': 'Restablecer Diseño',

    // Barra de herramientas
    'toolbar.play': 'Reproducir',
    'toolbar.playing': 'En Ejecución',
    'toolbar.pause': 'Pausar',
    'toolbar.stop': 'Detener',
    'toolbar.step': 'Paso',
    'toolbar.move_tool': 'Herramienta Mover (W)',
    'toolbar.rotate_tool': 'Herramienta Rotar (E)',
    'toolbar.scale_tool': 'Herramienta Escalar (R)',
    'toolbar.open_agent': 'Abrir panel Agente IA',
    'toolbar.agent_status': 'Agente: {activity}',
    'toolbar.language_select': 'Cambiar Idioma del Editor',

    // Paneles
    'panel.hierarchy': 'Jerarquía',
    'panel.viewport': 'Vista 3D',
    'panel.bridge': 'Puente',
    'panel.project': 'Proyecto',
    'panel.assets': 'Archivos',
    'panel.console': 'Consola',
    'panel.output': 'Salida',
    'panel.split_all': 'Dividir Todo',
    'panel.inspector': 'Inspector',
    'panel.scene': 'Escena',
    'panel.agent': 'Agente IA',
    'panel.godot': 'Puente Godot',

    // Jerarquía
    'hierarchy.title': 'Jerarquía',
    'hierarchy.search_placeholder': 'Buscar por nombre o t:Etiqueta...',
    'hierarchy.create_empty': 'Crear Vacío',
    'hierarchy.3d_object': 'Objeto 3D',
    'hierarchy.duplicate': 'Duplicar',
    'hierarchy.delete': 'Eliminar',
    'hierarchy.unpack_prefab': 'Desempaquetar Prefab',
    'hierarchy.empty_scene': 'No hay entidades en esta escena',

    // Inspector
    'inspector.title': 'Inspector',
    'inspector.no_selection': 'Selecciona una entidad para ver sus propiedades',
    'inspector.multi_selection': '{count} entidades seleccionadas',
    'inspector.name': 'Nombre',
    'inspector.tag': 'Etiqueta',
    'inspector.tags': 'Etiquetas',
    'inspector.add_tag': '+ Añadir Etiqueta...',
    'inspector.layer': 'Capa',
    'inspector.active': 'Activo',
    'inspector.static': 'Estático',
    'inspector.transform': 'Transformación',
    'inspector.position': 'Posición',
    'inspector.rotation': 'Rotación',
    'inspector.scale': 'Escala',
    'inspector.components': 'Componentes',
    'inspector.add_component': 'Añadir Componente',
    'inspector.search_components': 'Buscar componentes...',
    'inspector.remove_component': 'Eliminar Componente',
    'inspector.script_language': 'Idioma del Script',
    'inspector.script_src': 'Archivo Script',
    'inspector.transmute': 'Transmutar a...',

    // Archivos
    'assets.title': 'Explorador de Archivos',
    'assets.search_placeholder': 'Buscar archivos...',
    'assets.import': 'Importar Archivo',
    'assets.refresh': 'Actualizar',
    'assets.no_assets': 'No se encontraron archivos en la carpeta',

    // Consola
    'console.title': 'Consola',
    'console.clear': 'Limpiar',
    'console.filter_all': 'Todo',
    'console.logs': 'Registros',
    'console.warnings': 'Advertencias',
    'console.errors': 'Errores',
    'console.search_placeholder': 'Filtrar mensajes de la consola...',

    // Agente
    'agent.title': 'Agente IA',
    'agent.prompt_placeholder': 'Describe tu juego o mecánicas (ej. juego de plataformas 3D)...',
    'agent.send': 'Generar',
    'agent.thinking': 'El agente está pensando...',
    'agent.stop': 'Detener Agente',
    'agent.diff_apply': 'Aplicar Todos los Cambios',
    'agent.diff_reject': 'Rechazar Cambios',

    // Estado & Diálogos
    'status.project': 'Proyecto:',
    'status.scene': 'Escena:',
    'status.bridge_active': 'Sincronización Puente Activa',
    'status.bridge_offline': 'Sincronización Puente Desconectada',
    'dialog.confirm': 'Confirmar',
    'dialog.cancel': 'Cancelar',
    'dialog.close': 'Cerrar',
    'dialog.ok': 'Aceptar',
    'dialog.save': 'Guardar',
    'dialog.discard': 'Descartar',
  },
}

function loadSavedEditorLocale(): EditorLocale {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
      if (saved && (saved === 'en-US' || saved === 'id-ID' || saved === 'ja-JP' || saved === 'zh-CN' || saved === 'es-ES')) {
        return saved as EditorLocale
      }
    }
  } catch {}
  return 'en-US'
}

let activeEditorLocale: EditorLocale = loadSavedEditorLocale()
const localeListeners = new Set<(loc: EditorLocale) => void>()

export function setEditorLocale(locale: EditorLocale): void {
  if (EDITOR_TRANSLATIONS[locale]) {
    activeEditorLocale = locale
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale)
      }
    } catch {}
    for (const listener of localeListeners) {
      listener(locale)
    }
  }
}

export function getEditorLocale(): EditorLocale {
  return activeEditorLocale
}

export function tEditor(key: string, params?: Record<string, string | number>, overrideLocale?: EditorLocale): string {
  const loc = overrideLocale || activeEditorLocale
  const dict = EDITOR_TRANSLATIONS[loc] || EDITOR_TRANSLATIONS['en-US']
  let str = dict[key] || EDITOR_TRANSLATIONS['en-US'][key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

/**
 * Reactive React hook for i18n localization in any Linden Editor component.
 * Causes the component to automatically re-render whenever the language changes!
 */
export function useI18n() {
  const [currentLocale, setCurrentLocale] = useState<EditorLocale>(getEditorLocale())

  useEffect(() => {
    const handler = (loc: EditorLocale) => setCurrentLocale(loc)
    localeListeners.add(handler)
    return () => {
      localeListeners.delete(handler)
    }
  }, [])

  const t = (key: string, params?: Record<string, string | number>) => {
    return tEditor(key, params, currentLocale)
  }

  return {
    locale: currentLocale,
    currentLocale,
    setLocale: setEditorLocale,
    t,
  }
}

/** Global active locale fallback */
export const currentLocale: EditorLocale = getEditorLocale()
