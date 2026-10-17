import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InfoTip } from './Feedback'

const TEXT = 'The arithmetic average of the values.'
const NAME = `Mean: ${TEXT}`

function setup() {
  const user = userEvent.setup()
  render(
    <>
      <button type="button">Before</button>
      <InfoTip text={TEXT} label={NAME} />
      <button type="button">After</button>
    </>,
  )
  return { user, tip: screen.getByRole('button', { name: NAME }) }
}

const popup = () => screen.queryByRole('dialog')

describe('InfoTip', () => {
  it('names the button with the label, or with the text itself when there is none', () => {
    render(<InfoTip text={TEXT} />)
    expect(screen.getByRole('button', { name: TEXT })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a click opens the explanation without moving focus; a second click closes it', async () => {
    const { user, tip } = setup()
    await user.click(tip)
    expect(await screen.findByRole('dialog')).toHaveTextContent(TEXT)
    expect(tip).toHaveAttribute('aria-expanded', 'true')
    expect(tip).toHaveFocus()
    await user.click(tip)
    await waitFor(() => expect(popup()).toBeNull())
    expect(tip).toHaveAttribute('aria-expanded', 'false')
  })

  it('a tap opens it', async () => {
    const { user, tip } = setup()
    await user.pointer({ keys: '[TouchA]', target: tip })
    expect(await screen.findByRole('dialog')).toHaveTextContent(TEXT)
  })

  it('Escape closes it with focus on the button; Tab moves on and closes it too', async () => {
    const { user, tip } = setup()
    await user.click(tip)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(popup()).toBeNull())
    expect(tip).toHaveFocus()
    await user.click(tip)
    await screen.findByRole('dialog')
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
    await waitFor(() => expect(popup()).toBeNull())
  })

  it('a click on a tip the resting mouse opened keeps it open, also after the pointer leaves', async () => {
    const { user, tip } = setup()
    await user.hover(tip)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    // Read for a while, then click: the click asks for the tip, it must not take it away.
    await new Promise((r) => setTimeout(r, 700))
    await user.click(tip)
    await new Promise((r) => setTimeout(r, 300))
    expect(popup()).toHaveTextContent(TEXT)
    await user.unhover(tip)
    await new Promise((r) => setTimeout(r, 400))
    expect(popup()).toHaveTextContent(TEXT)
    // The next click closes it, as on a tip opened by a click.
    await user.click(tip)
    await waitFor(() => expect(popup()).toBeNull())
  })

  it('without a press, a tip the mouse opened closes when the pointer leaves', async () => {
    const { user, tip } = setup()
    await user.hover(tip)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    await user.unhover(tip)
    await waitFor(() => expect(popup()).toBeNull())
  })

  it('a tip opened by a press lets presses through to what it covers (the "?" of the rows above)', async () => {
    const { user, tip } = setup()
    await user.click(tip)
    // The positioner wraps the tip with the same box: it must let presses through as well.
    expect((await screen.findByRole('dialog')).closest('.pointer-events-none')).not.toBeNull()
  })

  it('a tip the mouse opened can be pointed at (WCAG 1.4.13), and a press on it dismisses it', async () => {
    const { user, tip } = setup()
    await user.hover(tip)
    const dialog = await screen.findByRole('dialog', {}, { timeout: 2000 })
    expect(dialog.closest('.pointer-events-none')).toBeNull()
    await user.hover(dialog)
    await new Promise((r) => setTimeout(r, 400))
    expect(popup()).toHaveTextContent(TEXT)
    await user.click(dialog)
    await waitFor(() => expect(popup()).toBeNull())
  })

  it('a press outside closes it', async () => {
    const { user, tip } = setup()
    await user.click(tip)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'After' }))
    await waitFor(() => expect(popup()).toBeNull())
  })

  it('opens and closes from the keyboard with Enter and Space', async () => {
    const { user, tip } = setup()
    await user.tab()
    await user.tab()
    expect(tip).toHaveFocus()
    // Focus alone does not open it: tabbing through a table of statistics stays quiet.
    expect(popup()).toBeNull()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toHaveTextContent(TEXT)
    expect(tip).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(popup()).toBeNull())
    await user.keyboard(' ')
    expect(await screen.findByRole('dialog')).toHaveTextContent(TEXT)
  })

  it('a resting mouse opens it after a short delay', async () => {
    const { user, tip } = setup()
    await user.hover(tip)
    // Not at once: a pointer passing over a column of "?" must not flash every tip.
    expect(popup()).toBeNull()
    expect(await screen.findByRole('dialog', {}, { timeout: 2000 })).toHaveTextContent(TEXT)
    expect(tip).not.toHaveFocus()
  })
})
