// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';

import { storiesOf } from '@storybook/react';
import { action } from '@storybook/addon-actions';
import { number, text } from '@storybook/addon-knobs';

import { getDefaultConversation } from '../../../test-both/helpers/getDefaultConversation';
import { setup as setupI18n } from '../../../../js/modules/i18n';
import enMessages from '../../../../_locales/en/messages.json';
import { ConversationType } from '../../../state/ducks/conversations';

import { ConversationDetailsHeader, Props } from './ConversationDetailsHeader';

const i18n = setupI18n('en', enMessages);

const story = storiesOf(
  'Components/Conversation/ConversationDetails/ConversationDetailsHeader',
  module
);

const createConversation = (): ConversationType =>
  getDefaultConversation({
    id: '',
    type: 'group',
    lastUpdated: 0,
    title: text('conversation title', 'Some Conversation'),
    groupDescription: text('description', 'This is a group description'),
  });

const createProps = (overrideProps: Partial<Props> = {}): Props => ({
  conversation: createConversation(),
  i18n,
  canEdit: false,
  startEditing: action('startEditing'),
  memberships: new Array(number('conversation members length', 0)),
  ...overrideProps,
});

story.add('Basic', () => {
  const props = createProps();

  return <ConversationDetailsHeader {...props} />;
});

story.add('Editable', () => {
  const props = createProps({ canEdit: true });

  return <ConversationDetailsHeader {...props} />;
});

story.add('Basic no-description', () => {
  const props = createProps();

  return (
    <ConversationDetailsHeader
      {...props}
      conversation={getDefaultConversation({
        title: 'My Group',
        type: 'group',
      })}
    />
  );
});

story.add('Editable no-description', () => {
  const props = createProps({ canEdit: true });

  return (
    <ConversationDetailsHeader
      {...props}
      conversation={getDefaultConversation({
        title: 'My Group',
        type: 'group',
      })}
    />
  );
});
