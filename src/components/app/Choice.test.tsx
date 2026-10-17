import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Choice } from './Choice'

describe('Choice (Base UI Select)', () => {
  it('shows the label of the selected item, never the raw value', () => {
    render(
      <Choice
        label="Scale"
        value="log"
        onChange={() => {}}
        items={[
          { value: 'linear', label: 'Linear' },
          { value: 'log', label: 'Logarithmic' },
        ]}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Scale' })
    expect(trigger).toHaveTextContent('Logarithmic')
    expect(trigger).not.toHaveTextContent(/^log$/)
  })

  it('calls onChange with the chosen value', async () => {
    const onChange = vi.fn()
    render(
      <Choice
        label="Model"
        value="linear"
        onChange={onChange}
        items={[
          { value: 'linear', label: 'Linear' },
          { value: 'polynomial', label: 'Polynomial' },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Polynomial' }))
    expect(onChange).toHaveBeenCalledWith('polynomial')
  })
})
