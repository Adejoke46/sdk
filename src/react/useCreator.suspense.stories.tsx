import type { Meta, StoryObj } from '@storybook/react';
import React, { Suspense, useState } from 'react';
import { useCreator } from './useCreator';
import { DorisioProvider } from './DorisioProvider';
import type { Creator } from '../types/models';
import type { DorisioClient } from '../client';

const meta: Meta<typeof CreatorSuspenseStory> = {
  title: 'Hooks/useCreator/Suspense',
  component: CreatorSuspenseStory,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof CreatorSuspenseStory>;

// Mock client that simulates a network delay so the Suspense fallback is visible.
function makeDelayedClient(delayMs = 1200): DorisioClient {
  const creators: Record<string, Creator> = {
    'creator-123': {
      id: 'creator-123',
      userId: 'user-456',
      username: 'creator1',
      displayName: 'Creator One',
      bio: 'Building in public.',
      avatar: null,
      verified: true,
      isPublic: true,
      totalEarnings: 1250,
      pendingBalance: 200,
      createdAt: '2024-01-01T00:00:00Z',
    },
    'creator-456': {
      id: 'creator-456',
      userId: 'user-789',
      username: 'creator2',
      displayName: 'Creator Two',
      bio: 'Open source enthusiast.',
      avatar: null,
      verified: false,
      isPublic: true,
      totalEarnings: 430,
      pendingBalance: 0,
      createdAt: '2024-02-01T00:00:00Z',
    },
  };

  return {
    request: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true, data: creators['creator-123'] });
        }, delayMs);
    }) as any,
    setToken: () => undefined,
    clearToken: () => undefined,
  } as unknown as DorisioClient;
}

function CreatorSuspenseStory() {
  const [creatorId, setCreatorId] = useState<string>('creator-123');
  const { creator, fetchCreator } = useCreator({ useSuspense: true });

  const handleFetch = () => {
    void fetchCreator(creatorId);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>useCreator with useSuspense</h2>
      <p>
        The hook opts into React Suspense by throwing a promise while the fetch is
        in flight. A <code>Suspense</code> boundary catches it and shows the
        fallback until the data resolves.
      </p>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          value={creatorId}
          onChange={(e) => setCreatorId(e.target.value)}
          style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '220px' }}
        />
        <button
          onClick={handleFetch}
          style={{
            padding: '8px 16px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Fetch Creator
        </button>
      </div>
      <Suspense fallback={<div style={{ padding: '20px', color: '#666' }}>Loading creator...</div>}>
        {creator ? (
          <div style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px' }}>
            <h3>{creator.displayName}</h3>
            <p>{creator.bio || 'No bio available.'}</p>
            <span style={{ color: '#666' }}>{creator.username}</span>
          </div>
        ) : null}
      </Suspense>
      <p style={{ marginTop: '16px', fontSize: '14px', color: '#666' }}>
        Creator ID: {creatorId}
      </p>
    </div>
  );
}

export const Default: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        client={makeDelayedClient()}
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};
