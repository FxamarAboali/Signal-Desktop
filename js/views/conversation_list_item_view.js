/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    // list of conversations, showing user/group and last message sent
    Whisper.ConversationListItemView = Whisper.View.extend({
        tagName: 'div',
        className: function() {
            return 'conversation-list-item contact ' + this.model.cid;
        },
        templateName: 'conversation-preview',
        events: {
            'click': 'select'
        },
        initialize: function() {
            this.listenTo(this.model, 'change', this.render); // auto update
            this.listenTo(this.model, 'destroy', this.remove); // auto update
            this.listenTo(this.model, 'opened', this.markSelected); // auto update
            extension.windows.onClosed(this.stopListening.bind(this));
            this.timeStampView = new Whisper.BriefTimestampView();
        },

        markSelected: function() {
            this.$el.addClass('selected').siblings('.selected').removeClass('selected');
        },

        select: function(e) {
            this.markSelected();
            this.$el.trigger('select', this.model);
        },

        render: function() {
            this.$el.html(
                Mustache.render(_.result(this,'template', ''), {
                    title: this.model.getTitle(),
                    last_message: this.model.get('lastMessage'),
                    last_message_timestamp: this.model.get('timestamp'),
                    number: this.model.getNumber(),
                    avatar: this.model.getAvatar(),
                    unreadCount: this.model.get('unreadCount')
                }, this.render_partials())
            );
            this.timeStampView.setElement(this.$('.last-timestamp'));
            this.timeStampView.update();

            twemoji.parse(this.el, { base: '/images/twemoji/', size: 16 });

            var unread = this.model.get('unreadCount');
            if (unread > 0) {
                this.$el.addClass('unread');
            } else {
                this.$el.removeClass('unread');
            }

            return this;
        }

    });
})();
