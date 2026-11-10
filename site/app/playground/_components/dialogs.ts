// The playground's dialogs are <dialog> elements found by id — whatever asks for one opens it.
export function openDialog(id: 'import-dialog' | 'shortcuts-dialog') {
  const dialog = document.getElementById(id)

  if (dialog instanceof HTMLDialogElement) dialog.showModal()
}
