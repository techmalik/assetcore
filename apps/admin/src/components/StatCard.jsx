import { Card, Group, Text, ThemeIcon } from '@mantine/core'

export default function StatCard({ label, value, sub, icon: Icon, color = 'indigo' }) {
  return (
    <Card padding="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fz="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
          <Text fz={28} fw={700} lh={1.2} mt={4}>{value}</Text>
          {sub && <Text fz="xs" c="dimmed" mt={2}>{sub}</Text>}
        </div>
        {Icon && (
          <ThemeIcon variant="light" color={color} size={38} radius="md">
            <Icon size={20} />
          </ThemeIcon>
        )}
      </Group>
    </Card>
  )
}
