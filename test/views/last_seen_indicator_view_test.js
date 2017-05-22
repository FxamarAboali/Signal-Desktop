/*
 * vim: ts=4:sw=4:expandtab
 */
describe('LastSeenIndicatorView', function() {
    // TODO: in electron branch, where we have access to real i18n, test rendered HTML

    it('renders provided count', function() {
        var view = new Whisper.LastSeenIndicatorView({count: 10});
        assert.equal(view.count, 10);
    });

});
