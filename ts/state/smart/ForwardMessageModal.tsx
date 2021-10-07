// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { connect } from 'react-redux';
import { mapDispatchToProps } from '../actions';
import {
  ForwardMessageModal,
  DataPropsType,
} from '../../components/ForwardMessageModal';
import { StateType } from '../reducer';
import { BodyRangeType } from '../../types/Util';
import { LinkPreviewType } from '../../types/message/LinkPreviews';
import { getAllComposableConversations } from '../selectors/conversations';
import { getLinkPreview } from '../selectors/linkPreviews';
import { getIntl } from '../selectors/user';
import { getEmojiSkinTone } from '../selectors/items';
import { selectRecentEmojis } from '../selectors/emojis';
import { AttachmentType } from '../../types/Attachment';

export type SmartForwardMessageModalProps = {
  attachments?: Array<AttachmentType>;
  doForwardMessage: (
    selectedContacts: Array<string>,
    messageBody?: string,
    attachments?: Array<AttachmentType>,
    linkPreview?: LinkPreviewType
  ) => void;
  isSticker: boolean;
  messageBody?: string;
  onClose: () => void;
  onEditorStateChange: (
    messageText: string,
    bodyRanges: Array<BodyRangeType>,
    caretLocation?: number
  ) => unknown;
  onTextTooLong: () => void;
};

const mapStateToProps = (
  state: StateType,
  props: SmartForwardMessageModalProps
): DataPropsType => {
  const {
    attachments,
    doForwardMessage,
    isSticker,
    messageBody,
    onClose,
    onEditorStateChange,
    onTextTooLong,
  } = props;

  const candidateConversations = getAllComposableConversations(state);
  const recentEmojis = selectRecentEmojis(state);
  const skinTone = getEmojiSkinTone(state);
  const linkPreview = getLinkPreview(state);

  return {
    attachments,
    candidateConversations,
    doForwardMessage,
    i18n: getIntl(state),
    isSticker,
    linkPreview,
    messageBody,
    onClose,
    onEditorStateChange,
    recentEmojis,
    skinTone,
    onTextTooLong,
  };
};

const smart = connect(mapStateToProps, {
  ...mapDispatchToProps,
  onPickEmoji: mapDispatchToProps.onUseEmoji,
});

export const SmartForwardMessageModal = smart(ForwardMessageModal);
