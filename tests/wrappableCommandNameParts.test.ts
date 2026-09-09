import { describe, it, expect } from 'vitest'
import { wrappableCommandNameParts } from '../settings'

const NBSP = ' '

describe('wrappableCommandNameParts', () => {
	it('single-word names pass through unchanged', () => {
		expect(wrappableCommandNameParts('Undo')).toEqual(['Undo'])
	})

	it('default rule: every space becomes non-breaking', () => {
		expect(wrappableCommandNameParts('Kill line')).toEqual([`Kill${NBSP}line`])
		expect(wrappableCommandNameParts('Kill region')).toEqual([`Kill${NBSP}region`])
	})

	it('trailing-direction exception: only the last space stays breakable', () => {
		expect(wrappableCommandNameParts('Kill word left')).toEqual([`Kill${NBSP}word left`])
		expect(wrappableCommandNameParts('Move to cell below')).toEqual([`Move${NBSP}to${NBSP}cell below`])
		expect(wrappableCommandNameParts('Align column center')).toEqual([`Align${NBSP}column center`])
	})

	it('Recenter-top-bottom splits into three <wbr>-joined segments', () => {
		expect(wrappableCommandNameParts('Recenter-top-bottom')).toEqual(['Recenter-', 'top-', 'bottom'])
	})

	it('a name not in the exception list keeps its trailing word non-breaking too', () => {
		// "Insert table" is 2 words with no trailing direction — default rule applies.
		expect(wrappableCommandNameParts('Insert table')).toEqual([`Insert${NBSP}table`])
	})

	it('exceptions with no direction word at all still keep their single space breakable', () => {
		expect(wrappableCommandNameParts('Duplicate row')).toEqual(['Duplicate row'])
		expect(wrappableCommandNameParts('Duplicate column')).toEqual(['Duplicate column'])
		expect(wrappableCommandNameParts('Uppercase word')).toEqual(['Uppercase word'])
		expect(wrappableCommandNameParts('Lowercase word')).toEqual(['Lowercase word'])
		expect(wrappableCommandNameParts('Capitalize word')).toEqual(['Capitalize word'])
		expect(wrappableCommandNameParts('Transpose chars')).toEqual(['Transpose chars'])
		expect(wrappableCommandNameParts('Delete row')).toEqual(['Delete row'])
		expect(wrappableCommandNameParts('Delete column')).toEqual(['Delete column'])
	})
})
