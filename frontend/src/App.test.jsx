import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the branded login surface with icon, password field, and action', () => {
    const { container } = render(<App />)

    expect(screen.getByRole('heading', { name: /kickbacks control/i })).toBeInTheDocument()
    expect(screen.getByText(/manage simulators, endpoints, and logs/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(container.querySelector('.brand-mark svg')).toBeInTheDocument()
  })
})
