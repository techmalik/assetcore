import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AppShell, Group, Burger, Title, Text, NavLink, Box, ScrollArea, Menu,
  Avatar, UnstyledButton, ActionIcon, useMantineColorScheme, Badge,
} from '@mantine/core'
import {
  IconLayoutDashboard, IconBuildingSkyscraper, IconUsers, IconReceipt2,
  IconLifebuoy, IconHistory, IconShieldLock, IconLogout, IconSun, IconMoon,
  IconChevronRight,
} from '@tabler/icons-react'
import { useAdminAuth } from '../lib/AdminAuthContext'
import { ROLE_LABELS } from '../lib/rbac'
import { NAV_BG, NAV_FG, NAV_ACTIVE } from '../theme'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard, cap: null },
  { to: '/orgs', label: 'Client', icon: IconBuildingSkyscraper, cap: 'org:read' },
  { to: '/users', label: 'Users', icon: IconUsers, cap: 'user:read' },
  { to: '/billing', label: 'Licence & Invoices', icon: IconReceipt2, cap: 'billing:read' },
  { to: '/support', label: 'Support', icon: IconLifebuoy, cap: 'impersonate' },
  { to: '/audit', label: 'Platform Audit', icon: IconHistory, cap: 'audit:read' },
  { to: '/settings', label: 'Platform Admins', icon: IconShieldLock, cap: 'admin:read' },
]

export default function AdminShell({ children }) {
  const [opened, setOpened] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { adminName, adminRole, can, signOut } = useAdminAuth()
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()

  const items = NAV.filter((n) => !n.cap || can(n.cap))

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={() => setOpened((o) => !o)} hiddenFrom="sm" size="sm" />
            <Group gap={8}>
              <Box w={22} h={22} style={{ background: NAV_BG, borderRadius: 6, display: 'grid', placeItems: 'center' }}>
                <Text c="white" fw={800} fz={13}>A</Text>
              </Box>
              <Title order={5} fw={700}>AssetCore</Title>
              <Badge size="xs" variant="light" color="indigo">Backoffice</Badge>
            </Group>
          </Group>
          <Group gap="xs">
            <ActionIcon variant="subtle" color="gray" onClick={toggleColorScheme} aria-label="Toggle color scheme">
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
            <Menu position="bottom-end" width={200}>
              <Menu.Target>
                <UnstyledButton>
                  <Group gap="xs">
                    <Avatar color="indigo" radius="xl" size={30}>
                      {(adminName?.[0] || '?').toUpperCase()}
                    </Avatar>
                    <Box visibleFrom="sm">
                      <Text fz="sm" fw={600} lh={1.1}>{adminName}</Text>
                      <Text fz="xs" c="dimmed">{ROLE_LABELS[adminRole] || adminRole}</Text>
                    </Box>
                    <IconChevronRight size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{adminName}</Menu.Label>
                <Menu.Item leftSection={<IconLogout size={15} />} onClick={signOut} color="red">
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar style={{ background: NAV_BG, border: 'none' }}>
        <AppShell.Section grow component={ScrollArea} px="sm" py="md">
          {items.map((n) => {
            const active = pathname === n.to || (n.to !== '/dashboard' && pathname.startsWith(n.to))
            const Icon = n.icon
            return (
              <NavLink
                key={n.to}
                label={n.label}
                leftSection={<Icon size={18} />}
                active={active}
                onClick={() => { navigate(n.to); setOpened(false) }}
                styles={{
                  root: {
                    color: NAV_FG,
                    borderRadius: 8,
                    marginBottom: 2,
                    backgroundColor: active ? NAV_ACTIVE : 'transparent',
                  },
                  label: { fontWeight: active ? 600 : 500, color: active ? '#fff' : NAV_FG },
                }}
              />
            )
          })}
        </AppShell.Section>
        <AppShell.Section px="md" py="sm">
          <Text fz="xs" c="dimmed" style={{ color: '#5b6b86' }}>v0.1 · internal only</Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main bg="var(--mantine-color-gray-0)">{children}</AppShell.Main>
    </AppShell>
  )
}
