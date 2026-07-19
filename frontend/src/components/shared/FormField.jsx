/**
 * Labeled form field wrapper for use inside FormModal's kt-form-stack.
 * Renders the shared kt-field-label (with a required marker) above its input.
 */
export default function FormField({ label, required = false, children }) {
  return (
    <div>
      <div className="kt-field-label">{label}{required ? ' *' : ''}</div>
      {children}
    </div>
  )
}
