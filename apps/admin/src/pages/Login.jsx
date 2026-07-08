import { useState } from 'react'
import {
  Center, Paper, Stack, Title, Text, TextInput, PasswordInput, Button, Group, Box, Alert,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconAlertTriangle } from '@tabler/icons-react'
import { signIn } from '../lib/auth'
import { NAV_BG } from '../theme'

export default function Login() {
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v) => (/^\S+@\S+$/.test(v) ? null : 'Enter a valid email'),
      password: (v) => (v ? null : 'Required'),
    },
  })

  const submit = async (values) => {
    setError(null)
    setLoading(true)
    try {
      await signIn(values.email, values.password)
      // On success the AdminAuthProvider's onAuthStateChange routes us in.
    } catch (err) {
      setError(err?.message || 'Sign in failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Center mih="100vh" bg="var(--mantine-color-gray-1)">
      <Paper withBorder radius="md" p="xl" w={400} shadow="sm">
        <Stack gap="lg">
          <Group gap={10}>
            <Box w={28} h={28} style={{ background: NAV_BG, borderRadius: 7, display: 'grid', placeItems: 'center' }}>
              <Text c="white" fw={800}>A</Text>
            </Box>
            <div>
              <Title order={4}>AssetCore Backoffice</Title>
              <Text size="xs" c="dimmed">Internal platform operations</Text>
            </div>
          </Group>

          {error && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} p="sm">{error}</Alert>
          )}

          <form onSubmit={form.onSubmit(submit)}>
            <Stack gap="sm">
              <TextInput
                label="Email" placeholder="you@assetcore.io"
                autoComplete="username" {...form.getInputProps('email')}
              />
              <PasswordInput
                label="Password" placeholder="••••••••"
                autoComplete="current-password" {...form.getInputProps('password')}
              />
              <Button type="submit" fullWidth mt="xs" loading={loading}>Sign in</Button>
            </Stack>
          </form>

          <Text size="xs" c="dimmed" ta="center">
            Access is restricted to authorized AssetCore staff.
          </Text>
        </Stack>
      </Paper>
    </Center>
  )
}
