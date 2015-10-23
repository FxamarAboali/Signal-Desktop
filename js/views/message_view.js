/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    Whisper.MessageView = Whisper.View.extend({
        tagName:   "li",
        template: $('#message').html(),
        initialize: function() {
            this.listenTo(this.model, 'change:body change:errors', this.render);
            this.listenTo(this.model, 'change:delivered', this.renderDelivered);
            this.listenTo(this.model, 'change', this.renderSent);
            this.listenTo(this.model, 'change:flags change:group_update', this.renderControl);
            this.listenTo(this.model, 'destroy', this.remove);
        },
        events: {
            'click time': 'select'
        },
        select: function() {
            this.$el.trigger('select', {message: this.model});
        },
        className: function() {
            return ["entry", this.model.get('type')].join(' ');
        },
        renderSent: function() {
            if (this.model.isOutgoing()) {
                this.$el.toggleClass('sent', !!this.model.get('sent'));
            }
        },
        renderDelivered: function() {
            if (this.model.get('delivered')) { this.$el.addClass('delivered'); }
        },
        renderErrors: function() {
            var errors = this.model.get('errors');
            if (_.size(errors) > 0) {
                this.$el.addClass('error');
                if (this.model.isIncoming()) {
                    this.$('.content').text(this.model.getDescription()).addClass('error-message');
                }
            } else {
                this.$el.removeClass('error');
            }
        },
        renderControl: function() {
            if (this.model.isEndSession() || this.model.isGroupUpdate()) {
                this.$el.addClass('control');
                this.$('.content').text(this.model.getDescription());
            } else {
                this.$el.removeClass('control');
            }
        },
        render: function() {
            var contact = this.model.getContact();
            this.$el.html(
                Mustache.render(this.template, {
                    message: this.model.get('body'),
                    timestamp: moment(this.model.get('sent_at')).format('LLL'),
                    iso_timestamp: moment(this.model.get('sent_at')).toISOString(),
                    sender: (contact && contact.getTitle()) || '',
                    avatar: (contact && contact.getAvatar())
                }, this.render_partials())
            );

            // only do the hassle of refreshing for messages less than 24 hours
            // otherwise it is more user friendly, to display the full datetime

            jQuery.timeago.settings.checkVisibility = false;
            if (-24 < moment(this.model.get('sent_at')).diff(new Date(), 'hours')) {
                this.$('time').timeago();
            }

            twemoji.parse(this.el, { base: '/images/twemoji/', size: 16 });

            var content = this.$('.content');
            var escaped = content.html();
            content.html(escaped.replace(/\n/g, '<br>').replace(/(^|[\s\n]|<br\/?>)((?:https?|ftp):\/\/[\-A-Z0-9+\u0026\u2019@#\/%?=()~_|!:,.;]*[\-A-Z0-9+\u0026@#\/%=~()_|])/gi, "$1<a href='$2' target='_blank'>$2</a>"));

            this.renderSent();
            this.renderDelivered();
            this.renderControl();
            this.renderErrors();

            this.$('.attachments').append(
                this.model.get('attachments').map(function(attachment) {
                    return new Whisper.AttachmentView({
                        model: attachment
                    }).render().el;
                })
            );

            return this;
        }
    });

})();
