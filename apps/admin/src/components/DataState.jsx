import { Center, Loader, Alert, Text, Stack, Button } from '@mantine/core'
import { IconAlertTriangle, IconInbox } from '@tabler/icons-react'

// Wraps a data view with the three required states. Renders children only when
// loaded, not errored, and non-empty.
export default function DataState({ loading, error, empty, emptyLabel = 'Nothing here yet.', onRetry, children }) {
  if (loading) {
    return <Center py={64}><Loader /></Center>
  }
  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Couldn’t load" my="md">
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{error.message || String(error)}</Text>
          {onRetry && <Button size="xs" variant="light" color="red" onClick={onRetry}>Retry</Button>}
        </Stack>
      </Alert>
    )
  }
  if (empty) {
    return (
      <Center py={56}>
        <Stack align="center" gap={6}>
          <IconInbox size={32} color="var(--mantine-color-gray-5)" />
          <Text c="dimmed" size="sm">{emptyLabel}</Text>
        </Stack>
      </Center>
    )
  }
  return children
}
