import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Container,
  Grid,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Paper,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { useConversationMetrics } from '../hooks/useConversationMetrics';

const Dashboard: React.FC = () => {
  const { data, isLoading, error, isGlobalView, setIsGlobalView } = useConversationMetrics();

  const handleViewChange = (
    event: React.MouseEvent<HTMLElement>,
    newView: boolean | null
  ) => {
    if (newView !== null) {
      setIsGlobalView(newView);
    }
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Alert severity="error">
          Error loading dashboard data: {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      </Container>
    );
  }

  const formatXAxisTick = (tickItem: string, period: 'hour' | 'day' | 'month') => {
    const date = new Date(tickItem);
    if (period === 'hour') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (period === 'day') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Usage Dashboard
        </Typography>
        <ToggleButtonGroup
          value={isGlobalView}
          exclusive
          onChange={handleViewChange}
          aria-label="view toggle"
        >
          <ToggleButton value={true} aria-label="global view">
            Global View
          </ToggleButton>
          <ToggleButton value={false} aria-label="channel view">
            Current Channel
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Grid container spacing={3}>
        {/* Summary Cards */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Users Today
              </Typography>
              <Typography variant="h3">
                {data?.activeUsersToday || 0}
              </Typography>
              <Chip
                label="Last 24 hours"
                size="small"
                color="primary"
                sx={{ mt: 1 }}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Users This Week
              </Typography>
              <Typography variant="h3">
                {data?.activeUsersWeek || 0}
              </Typography>
              <Chip
                label="Last 7 days"
                size="small"
                color="primary"
                sx={{ mt: 1 }}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Users This Month
              </Typography>
              <Typography variant="h3">
                {data?.activeUsersMonth || 0}
              </Typography>
              <Chip
                label="Last 30 days"
                size="small"
                color="primary"
                sx={{ mt: 1 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* 24 Hour Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Conversations - Last 24 Hours
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data?.last24Hours || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(tick) => formatXAxisTick(tick, 'hour')}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(label) => new Date(label).toLocaleString()}
                  formatter={(value: number) => [value, 'Count']}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="conversationCount"
                  name="Conversations"
                  stroke="#8884d8"
                  fill="#8884d8"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="activeUsers"
                  name="Active Users"
                  stroke="#82ca9d"
                  fill="#82ca9d"
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* 7 Day Chart */}
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Conversations - Last 7 Days
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data?.last7Days || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(tick) => formatXAxisTick(tick, 'day')}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  formatter={(value: number) => [value, 'Count']}
                />
                <Legend />
                <Bar
                  dataKey="conversationCount"
                  name="Conversations"
                  fill="#8884d8"
                />
                <Bar
                  dataKey="activeUsers"
                  name="Active Users"
                  fill="#82ca9d"
                />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* 12 Month Chart */}
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Conversations - Last 12 Months
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data?.last12Months || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(tick) => formatXAxisTick(tick, 'month')}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(label) => new Date(label).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric',
                  })}
                  formatter={(value: number) => [value, 'Count']}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="conversationCount"
                  name="Conversations"
                  stroke="#8884d8"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="activeUsers"
                  name="Active Users"
                  stroke="#82ca9d"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Dashboard;