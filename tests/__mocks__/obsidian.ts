export class App {}

export class Plugin {
	app: any = {}
	constructor(_app?: any, _manifest?: any) {}
	addCommand() {}
	loadData(): Promise<any> { return Promise.resolve({}) }
	saveData(_data: any): Promise<void> { return Promise.resolve() }
}

export class PluginSettingTab {
	app: any
	containerEl: any = { empty: () => {} }
	constructor(_app: any, _plugin: any) {}
	display() {}
}

export class Setting {
	constructor(_containerEl: any) {}
	setName(_name: string) { return this }
	setDesc(_desc: string) { return this }
	addToggle(_cb: (toggle: any) => any) { return this }
}

export class Notice {
	constructor(_message?: string, _timeout?: number) {}
}

export class MarkdownView {}
export class Editor {}
export const Platform = { isMacOS: false }
export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt'
